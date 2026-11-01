-- Explicit opt-in only. Check V3 identity/structure and take a backup first.
-- No existing rows, accounts, roles or menu grants are changed.
CREATE TABLE IF NOT EXISTS wp_certificate_job (
 id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 owner_user_id BIGINT NOT NULL,
 dept_id BIGINT DEFAULT NULL COMMENT 'Server-captured department at submission',
 owner_name VARCHAR(64) NOT NULL,
 client_key CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 state VARCHAR(24) NOT NULL DEFAULT 'draft',
 cancel_requested TINYINT NOT NULL DEFAULT 0,
 expected_items INT NOT NULL,
 total_bytes BIGINT NOT NULL DEFAULT 0,
 manifest_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
 create_by VARCHAR(64) DEFAULT NULL,
 update_by VARCHAR(64) DEFAULT NULL,
 create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 update_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 PRIMARY KEY(id), UNIQUE KEY uk_wp_job_owner_key(owner_user_id,client_key),
 KEY idx_wp_job_state(state,create_time), KEY idx_wp_job_owner(owner_user_id,create_time)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Durable certificate tasks; no proof bytes or JWT';
CREATE TABLE IF NOT EXISTS wp_certificate_job_item (
 job_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 item_index INT NOT NULL,
 spool_token CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 proof_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 proof_bytes BIGINT NOT NULL,
 state VARCHAR(24) NOT NULL DEFAULT 'queued',
 claim_token CHAR(36) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
 attempts INT NOT NULL DEFAULT 0,
 entry_id BIGINT DEFAULT NULL,
 result_code VARCHAR(48) DEFAULT NULL,
 cleanup_state VARCHAR(16) NOT NULL DEFAULT 'retained',
 create_by VARCHAR(64) DEFAULT NULL,
 update_by VARCHAR(64) DEFAULT NULL,
 create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 update_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 PRIMARY KEY(job_id,item_index), UNIQUE KEY uk_wp_job_spool(spool_token),
 KEY idx_wp_job_item_state(state,cleanup_state),
 CONSTRAINT fk_wp_job_item FOREIGN KEY(job_id) REFERENCES wp_certificate_job(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Task item summaries and private spool references, not original proof data';
