use crate::{runtime::Runtime, store::*};
use anyhow::{anyhow, Result};
use serde_json::{json, Value};
impl Runtime {
    pub(crate) async fn slice02_action(&self, name: &str, arg: &Value) -> Result<Option<Value>> {
        let output = match name {
            "cloudProviders" => self
                .model()
                .platform
                .as_ref()
                .ok_or_else(|| anyhow!("Provider registry unavailable."))?
                .providers()?,
            "cloudModels" => json!(self
                .model()
                .platform
                .as_ref()
                .unwrap()
                .models(arg["provider"].as_str())?),
            "discoverModels" => {
                self.model()
                    .platform
                    .as_ref()
                    .unwrap()
                    .discover(st(arg, "provider"))
                    .await?
            }
            "saveProvider" => self.model().platform.as_ref().unwrap().save_provider(arg)?,
            "saveCredential" => self
                .model()
                .platform
                .as_ref()
                .unwrap()
                .save_credential(arg)?,
            "credentialAction" => self
                .model()
                .platform
                .as_ref()
                .unwrap()
                .credential_action(arg)?,
            "registerModel" => self.model().platform.as_ref().unwrap().register(arg)?,
            "toggleModel" => self
                .model()
                .platform
                .as_ref()
                .unwrap()
                .toggle_model(st(arg, "id"), arg["enabled"] == true)?,
            "testConnection" => {
                let p = self.model().platform.unwrap();
                let spec = p.spec(st(arg, "model"))?;
                let provider = p.provider(&spec.provider)?;
                let mut target = crate::adapters::Target {
                    spec: spec.clone(),
                    provider,
                    credential: arg["credential"].as_str().map(String::from),
                    reasoning: None,
                };
                target.spec.output = Some(256);
                if arg["allowBillable"] != true && !spec.free {
                    return Err(anyhow!("This model is not verified free. Explicitly allow this connection-test inference, or validate model discovery without generating."));
                }
                let mut chunks = 0;
                let (answer, usage) = crate::adapters::stream(
                    &p,
                    &[target],
                    json!([{"role":"user","content":"Reply with exactly: connection works."}]),
                    &self.shutdown.child_token(),
                    |_, _| {
                        chunks += 1;
                        Ok(())
                    },
                )
                .await?;
                Ok::<_, anyhow::Error>(
                    json!({"success":!answer.is_empty(),"stream_chunks":chunks,"usage":usage}),
                )?
            }
            "importAttachment" => {
                let file = arg.clone();
                let dir = self
                    .db(|s| {
                        let file =
                            s.db.path()
                                .ok_or_else(|| anyhow!("Attachment storage unavailable."))?;
                        Ok(std::path::Path::new(file)
                            .parent()
                            .unwrap()
                            .join("attachments"))
                    })
                    .await?;
                let staged =
                    tokio::task::spawn_blocking(move || crate::documents::stage(&dir, &file))
                        .await??;
                self.db(move |s| crate::documents::commit(s, staged))
                    .await?
            }
            "attachmentPreview" => {
                let id = arg.as_str().unwrap_or(st(arg, "id")).to_owned();
                let chunk = n(arg, "chunk");
                self.db(move|s|{let a=s.one("SELECT id,name,mime,bytes,path FROM attachments WHERE id=?",&[&id])?;if a.is_null(){return Err(anyhow!("Attachment unavailable."))}if st(&a,"mime").starts_with("image/"){use base64::Engine;Ok(json!({"name":a["name"],"image":format!("data:{};base64,{}",st(&a,"mime"),base64::engine::general_purpose::STANDARD.encode(std::fs::read(st(&a,"path"))?))}))}else{let rows=s.all("SELECT text FROM attachment_chunks WHERE attachment=? AND ordinal>=? ORDER BY ordinal LIMIT 3",&[&id,&chunk])?;Ok(json!({"name":a["name"],"text":rows.iter().map(|r|st(r,"text")).collect::<Vec<_>>().join("\n\n"),"excerpt":true,"chunk":chunk}))}}).await?
            }
            "attachmentInfo" => {
                let id = arg.as_str().unwrap_or("").to_owned();
                self.db(move |s| {
                    s.one(
                        "SELECT id,name,mime,bytes,sha256,created FROM attachments WHERE id=?",
                        &[&id],
                    )
                })
                .await?
            }
            "draftAttachments" => {
                self.db(|s| {
                    Ok(serde_json::from_str::<Value>(
                        &s.get("draft_attachments", "[]"),
                    )?)
                })
                .await?
            }
            "saveDraftAttachments" => {
                let ids = arg
                    .as_array()
                    .filter(|a| a.len() <= 8)
                    .ok_or_else(|| anyhow!("Attach at most eight files."))?
                    .clone();
                self.db(move |s| {
                    s.set("draft_attachments", json!(ids))?;
                    Ok(Value::Null)
                })
                .await?
            }
            "clearChat" => {
                self.db(|s| {
                    let id = n(
                        &s.one("SELECT coalesce(max(id),0)+1 AS id FROM messages", &[])?,
                        "id",
                    );
                    s.set("display_start", id)?;
                    Ok(json!({"boundary":id}))
                })
                .await?
            }
            "responseDetails" => {
                let id = arg.as_i64().unwrap_or(0);
                self.db(move |s| {
                    let row = s.one(
                        "SELECT metadata FROM response_details WHERE message=?",
                        &[&id],
                    )?;
                    Ok(serde_json::from_str::<Value>(st(&row, "metadata")).unwrap_or(Value::Null))
                })
                .await?
            }
            "componentState" => {
                let arg = arg.clone();
                self.db(move |s| {
                    let row = s.one(
                        "SELECT state FROM component_state WHERE message=? AND component=?",
                        &[&n(&arg, "message"), &st(&arg, "component")],
                    )?;
                    Ok(serde_json::from_str::<Value>(st(&row, "state")).unwrap_or(Value::Null))
                })
                .await?
            }
            "saveComponentState" => {
                if arg["state"].to_string().len() > 32000 || st(arg, "component").len() > 100 {
                    return Err(anyhow!("Component state is too large."));
                }
                let arg = arg.clone();
                self.db(move |s| {
                    s.db.execute(
                        "INSERT OR REPLACE INTO component_state VALUES(?,?,?)",
                        rusqlite::params![
                            n(&arg, "message"),
                            st(&arg, "component"),
                            arg["state"].to_string()
                        ],
                    )?;
                    Ok(Value::Null)
                })
                .await?
            }
            _ => return Ok(None),
        };
        Ok(Some(output))
    }
}
