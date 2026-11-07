use crate::{context::count, store::*};
use anyhow::{anyhow, Result};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    io::{Cursor, Read},
    path::Path,
};
pub const MAX_FILE: usize = 25 * 1024 * 1024;
fn mime(name: &str, bytes: &[u8]) -> Result<&'static str> {
    let ext = name.rsplit('.').next().unwrap_or("").to_lowercase();
    let image = if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("image/png")
    } else if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        Some("image/jpeg")
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        Some("image/gif")
    } else if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") {
        Some("image/webp")
    } else {
        None
    };
    if let Some(m) = image {
        return Ok(m);
    }
    match ext.as_str(){"pdf" if bytes.starts_with(b"%PDF")=>Ok("application/pdf"),"docx"=>Ok("application/vnd.openxmlformats-officedocument.wordprocessingml.document"),"xlsx"=>Ok("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),"pptx"=>Ok("application/vnd.openxmlformats-officedocument.presentationml.presentation"),"txt"|"md"|"rs"|"py"|"js"|"ts"|"html"|"css"|"json"|"jsonl"|"log"|"csv"|"tsv"|"xml"|"yaml"|"yml"|"sql"|"toml"=>{std::str::from_utf8(bytes).map_err(|_|anyhow!("This text file is not UTF-8."))?;Ok("text/plain")},_=>Err(anyhow!("Unsupported file type. Audio, video, executable files and macro-enabled documents are not accepted."))}
}
pub fn zip_guard(bytes: &[u8]) -> Result<()> {
    let mut zip = zip::ZipArchive::new(Cursor::new(bytes))?;
    if zip.len() > 5000 {
        return Err(anyhow!("Document contains too many entries."));
    }
    let mut total = 0u64;
    for i in 0..zip.len() {
        let file = zip.by_index(i)?;
        let name = file.name().to_lowercase();
        if file.enclosed_name().is_none()
            || name.contains("vbaproject")
            || name.ends_with(".exe")
            || file.is_symlink()
        {
            return Err(anyhow!("Unsafe document package."));
        }
        total = total.saturating_add(file.size());
        if total > 50_000_000
            || file.size() > 20_000_000
            || file.size() > file.compressed_size().saturating_mul(300).max(1_000_000)
        {
            return Err(anyhow!("Document expansion exceeds safe limits."));
        }
    }
    Ok(())
}
pub fn extract(bytes: &[u8], name: &str) -> Result<String> {
    let kind = mime(name, bytes)?;
    if kind.starts_with("image/") {
        return Ok(String::new());
    }
    if kind == "text/plain" {
        return Ok(std::str::from_utf8(bytes)?.to_owned());
    }
    if kind == "application/pdf" {
        return pdf_extract::extract_text_from_mem(bytes).map_err(|_| {
            anyhow!("PDF could not be extracted; scanned PDFs need an available vision workflow.")
        });
    }
    zip_guard(bytes)?;
    if name.to_lowercase().ends_with(".xlsx") {
        use calamine::{open_workbook_auto_from_rs, Reader};
        let mut workbook = open_workbook_auto_from_rs(Cursor::new(bytes.to_vec()))?;
        let mut text = String::new();
        for sheet in workbook.sheet_names().to_owned() {
            text.push_str(&format!("\nSheet: {sheet}\n"));
            if let Ok(range) = workbook.worksheet_range(&sheet) {
                if range.height().saturating_mul(range.width()) > 500000 {
                    return Err(anyhow!("Workbook exceeds the supported cell limit."));
                }
                for row in range.rows() {
                    text.push_str(
                        &row.iter()
                            .map(ToString::to_string)
                            .collect::<Vec<_>>()
                            .join("\t"),
                    );
                    text.push('\n');
                    if text.len() > 12_000_000 {
                        return Err(anyhow!("Workbook extracted text exceeds the limit."));
                    }
                }
            }
        }
        return Ok(text);
    }
    let mut zip = zip::ZipArchive::new(Cursor::new(bytes))?;
    let mut names: Vec<String> = zip
        .file_names()
        .filter(|n| {
            *n == "word/document.xml" || (n.starts_with("ppt/slides/slide") && n.ends_with(".xml"))
        })
        .map(String::from)
        .collect();
    names.sort_by_key(|n| {
        re(r"\d+")
            .find(n)
            .and_then(|m| m.as_str().parse::<usize>().ok())
            .unwrap_or(0)
    });
    let mut text = String::new();
    for name in names {
        let mut xml = String::new();
        zip.by_name(&name)?
            .take(20_000_001)
            .read_to_string(&mut xml)?;
        let mut reader = quick_xml::Reader::from_str(&xml);
        let mut in_text = false;
        loop {
            match reader.read_event() {
                Ok(quick_xml::events::Event::Start(e)) => {
                    in_text = e.local_name().as_ref() == b"t";
                }
                Ok(quick_xml::events::Event::Text(e)) if in_text => {
                    text.push_str(&quick_xml::escape::unescape(&e.decode()?)?);
                    text.push(' ');
                }
                Ok(quick_xml::events::Event::End(e)) => {
                    if e.local_name().as_ref() == b"p" {
                        text.push('\n');
                    }
                    in_text = false;
                }
                Ok(quick_xml::events::Event::Eof) => break,
                Err(_) => return Err(anyhow!("Document XML is invalid.")),
                _ => {}
            }
        }
        text.push('\n');
    }
    if text.trim().is_empty() {
        return Err(anyhow!("No readable document text was found."));
    }
    Ok(text)
}
pub struct Staged {
    id: String,
    name: String,
    kind: String,
    bytes: usize,
    path: std::path::PathBuf,
    digest: String,
    text: String,
}
pub fn stage(dir: &Path, arg: &Value) -> Result<Staged> {
    let name = st(arg, "name");
    if name.is_empty()
        || name.len() > 240
        || Path::new(name).file_name().and_then(|s| s.to_str()) != Some(name)
        || name.contains(['/', '\\', '\0'])
    {
        return Err(anyhow!("Invalid attachment name."));
    }
    let raw = st(arg, "data");
    if raw.len() > MAX_FILE * 4 / 3 + 8 {
        return Err(anyhow!("Attachment exceeds 25 MiB."));
    }
    let bytes = STANDARD
        .decode(raw)
        .map_err(|_| anyhow!("Invalid file data."))?;
    if bytes.len() > MAX_FILE {
        return Err(anyhow!("Attachment exceeds 25 MiB."));
    }
    let kind = mime(name, &bytes)?;
    if kind.starts_with("image/") {
        let (width, height) = image::ImageReader::new(Cursor::new(&bytes))
            .with_guessed_format()?
            .into_dimensions()
            .map_err(|_| anyhow!("Image header is invalid."))?;
        if width == 0
            || height == 0
            || width > 16000
            || height > 16000
            || u64::from(width) * u64::from(height) > 64000000
        {
            return Err(anyhow!("Image dimensions exceed safe limits."));
        }
    }

    if kind.contains("openxml") {
        zip_guard(&bytes)?;
    }
    let id = uuid::Uuid::new_v4().to_string();
    std::fs::create_dir_all(dir)?;
    let path = dir.join(&id);
    std::fs::write(&path, &bytes)?;
    // Native parsing executes in a resource-limited helper process; it cannot stall the UI.
    let text = if kind.starts_with("image/") {
        String::new()
    } else {
        match isolated_extract(&path, name) {
            Ok(t) => t,
            Err(e) => {
                let _ = std::fs::remove_file(&path);
                return Err(e);
            }
        }
    };
    if text.len() > 12_000_000 {
        let _ = std::fs::remove_file(&path);
        return Err(anyhow!("Extracted text exceeds 12 MB; split the document."));
    }
    let digest = format!("{:x}", Sha256::digest(&bytes));
    Ok(Staged {
        id,
        name: name.into(),
        kind: kind.into(),
        bytes: bytes.len(),
        path,
        digest,
        text,
    })
}
pub fn commit(s: &Store, staged: Staged) -> Result<Value> {
    let Staged {
        id,
        name,
        kind,
        bytes,
        path,
        digest,
        text,
    } = staged;
    s.transaction(|| {
        s.db.execute(
            "INSERT INTO attachments(id,name,mime,bytes,path,sha256) VALUES(?,?,?,?,?,?)",
            rusqlite::params![id, name, kind, bytes as i64, path.to_string_lossy(), digest],
        )?;
        let chars: Vec<char> = text.chars().collect();
        for (ordinal, start) in (0..chars.len()).step_by(1800).enumerate() {
            let end = (start + 2200).min(chars.len());
            let chunk: String = chars[start..end].iter().collect();
            s.db.execute(
                "INSERT INTO attachment_chunks(attachment,ordinal,text) VALUES(?,?,?)",
                rusqlite::params![id, ordinal as i64, chunk],
            )?;
        }
        Ok(())
    })?;
    Ok(
        json!({"id":id,"name":name,"mime":kind,"bytes":bytes,"chunks":text.chars().count().div_ceil(1800)}),
    )
}
pub fn isolated_extract(path: &Path, name: &str) -> Result<String> {
    use std::process::{Command, Stdio};
    let mut command = Command::new(std::env::current_exe()?);
    command
        .arg("--extract-document")
        .arg(path)
        .arg(name)
        .env_clear()
        .env(
            "SystemRoot",
            std::env::var("SystemRoot").unwrap_or("C:\\Windows".into()),
        )
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let mut child = command.spawn()?;
    #[cfg(windows)]
    let _limits = ParserJob::attach(&child).inspect_err(|_| {
        let _ = child.kill();
    })?;

    {
        use std::io::Write;
        child.stdin.take().unwrap().write_all(b"1")?;
    }
    let output = child.stdout.take().unwrap();
    let reader = std::thread::spawn(move || {
        let mut bytes = vec![];
        let _ = output.take(12_000_001).read_to_end(&mut bytes);
        bytes
    });
    let start = std::time::Instant::now();
    let status = loop {
        if let Some(status) = child.try_wait()? {
            break status;
        }
        if start.elapsed().as_secs() > 12 {
            let _ = child.kill();
            let _ = child.wait();
            return Err(anyhow!(
                "Document parsing timed out; no partial extraction was accepted."
            ));
        }
        std::thread::sleep(std::time::Duration::from_millis(20));
    };
    let bytes = reader
        .join()
        .map_err(|_| anyhow!("Document parser failed."))?;
    if !status.success() || bytes.len() > 12_000_000 {
        return Err(anyhow!(
            "Document parser could not safely extract this file."
        ));
    }
    Ok(String::from_utf8(bytes)?)
}
pub fn evidence(
    s: &Store,
    ids: &[String],
    text: &str,
    budget: usize,
) -> Result<(Value, Vec<Value>)> {
    if ids.len() > 8 {
        return Err(anyhow!("Attach at most eight files per message."));
    }
    let mut evidence = vec![];
    let mut images = vec![];
    let mut used = 0;
    for id in ids {
        let a = s.one(
            "SELECT id,name,mime,bytes,path FROM attachments WHERE id=?",
            &[&id],
        )?;
        if a.is_null() {
            return Err(anyhow!("An attachment is no longer available."));
        }
        if st(&a, "mime").starts_with("image/") {
            if n(&a, "bytes") > 20_000_000 {
                return Err(anyhow!("Image exceeds 20 MB."));
            }
            images.push(json!({"type":"image_url","image_url":{"url":format!("data:{};base64,{}",st(&a,"mime"),STANDARD.encode(std::fs::read(st(&a,"path"))?))}}));
            continue;
        }
        let q = query(text);
        let mut rows = if q.is_empty() {
            vec![]
        } else {
            s.all("SELECT c.* FROM attachment_fts f JOIN attachment_chunks c ON c.id=f.rowid WHERE attachment_fts MATCH ? AND c.attachment=? ORDER BY rank LIMIT 8",&[&q,&id])?
        };
        if rows.is_empty() {
            rows = s.all(
                "SELECT * FROM attachment_chunks WHERE attachment=? ORDER BY ordinal LIMIT 8",
                &[&id],
            )?;
        }
        for row in rows {
            let cost = count(st(&row, "text")) + 40;
            if used + cost <= budget {
                evidence.push(json!({"attachment":id,"name":a["name"],"chunk":row["ordinal"],"text":crate::context::clean(&s.safe(st(&row,"text"),false,None)?)}));
                used += cost;
            }
        }
        let total = n(
            &s.one(
                "SELECT count(*) AS n FROM attachment_chunks WHERE attachment=?",
                &[&id],
            )?,
            "n",
        );
        evidence.push(json!({"attachment":id,"name":a["name"],"total_chunks":total,"retrieval":"Selected passages only when the document exceeds available context. Original file retained; do not claim all pages were reviewed."}));
    }
    Ok((json!(evidence), images))
}

#[cfg(windows)]
struct ParserJob(windows_sys::Win32::Foundation::HANDLE);
#[cfg(windows)]
impl ParserJob {
    fn attach(child: &std::process::Child) -> Result<Self> {
        use std::os::windows::io::AsRawHandle;
        use windows_sys::Win32::System::JobObjects::*;
        let handle = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
        if handle.is_null() {
            return Err(anyhow!("Could not isolate document parser."));
        }
        let job = Self(handle);
        let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = unsafe { std::mem::zeroed() };
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_PROCESS_MEMORY
            | JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
            | JOB_OBJECT_LIMIT_ACTIVE_PROCESS;
        limits.ProcessMemoryLimit = 512 * 1024 * 1024;
        limits.BasicLimitInformation.ActiveProcessLimit = 1;
        if unsafe {
            SetInformationJobObject(
                handle,
                JobObjectExtendedLimitInformation,
                &limits as *const _ as _,
                std::mem::size_of_val(&limits) as u32,
            )
        } == 0
            || unsafe { AssignProcessToJobObject(handle, child.as_raw_handle() as _) } == 0
        {
            return Err(anyhow!("Windows could not apply document parser limits."));
        }
        Ok(job)
    }
}
#[cfg(windows)]
impl Drop for ParserJob {
    fn drop(&mut self) {
        unsafe { windows_sys::Win32::Foundation::CloseHandle(self.0) };
    }
}

/// Only citations to exact passages actually supplied in this request are actionable.
pub fn ground_references(answer: &str, evidence: &Value) -> String {
    re(r"\[D:([A-Za-z0-9-]+):(\d+)\]")
        .replace_all(answer, |c: &regex::Captures| {
            let ordinal = c[2].parse::<i64>().unwrap_or(-1);
            if evidence
                .as_array()
                .into_iter()
                .flatten()
                .any(|e| st(e, "attachment") == &c[1] && e["chunk"].as_i64() == Some(ordinal))
            {
                c[0].to_string()
            } else {
                "[document source unavailable]".into()
            }
        })
        .into_owned()
}
