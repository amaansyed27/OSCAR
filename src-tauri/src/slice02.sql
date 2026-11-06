CREATE TABLE IF NOT EXISTS cloud_providers(id TEXT PRIMARY KEY, definition TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS cloud_credentials(id TEXT PRIMARY KEY,provider TEXT NOT NULL,nickname TEXT NOT NULL,source TEXT NOT NULL,secret TEXT,enabled INTEGER NOT NULL DEFAULT 1,fingerprint TEXT NOT NULL,cooldown_until INTEGER DEFAULT 0,last_success TEXT,last_error TEXT);
CREATE TABLE IF NOT EXISTS cloud_models(id TEXT PRIMARY KEY,provider TEXT NOT NULL,definition TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 1,updated TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS cloud_model_provider ON cloud_models(provider,enabled);
CREATE TABLE IF NOT EXISTS response_details(message INTEGER PRIMARY KEY REFERENCES messages(id),metadata TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS attachments(id TEXT PRIMARY KEY,name TEXT NOT NULL,mime TEXT NOT NULL,bytes INTEGER NOT NULL,path TEXT NOT NULL,sha256 TEXT NOT NULL,created TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS attachment_chunks(id INTEGER PRIMARY KEY,attachment TEXT REFERENCES attachments(id),ordinal INTEGER,text TEXT NOT NULL);
CREATE VIRTUAL TABLE IF NOT EXISTS attachment_fts USING fts5(text,content='attachment_chunks',content_rowid='id');
CREATE TRIGGER IF NOT EXISTS attachment_insert AFTER INSERT ON attachment_chunks BEGIN INSERT INTO attachment_fts(rowid,text) VALUES(new.id,new.text);END;
CREATE TABLE IF NOT EXISTS message_attachments(message INTEGER REFERENCES messages(id),attachment TEXT REFERENCES attachments(id),PRIMARY KEY(message,attachment));
CREATE TABLE IF NOT EXISTS component_state(message INTEGER REFERENCES messages(id),component TEXT,state TEXT NOT NULL,PRIMARY KEY(message,component));

CREATE UNIQUE INDEX IF NOT EXISTS environment_slot ON cloud_credentials(provider,source) WHERE source LIKE 'environment:%';
