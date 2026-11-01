-- Explicit opt-in migration. Run only after checking the target schema and taking a backup.
-- Does not grant certificate permissions to existing ordinary roles.
CREATE TABLE IF NOT EXISTS wp_certificate (
    id BIGINT NOT NULL AUTO_INCREMENT COMMENT '机构记录编号，不是证书指纹',
    owner_user_id BIGINT NOT NULL COMMENT '提交者账号 ID，由服务端填写',
    dept_id BIGINT DEFAULT NULL COMMENT '提交时所属部门，用于数据范围过滤',
    certificate_id CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '原签名字节 SHA-256，完整与部分证据可相同',
    proof_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '本次证书原字节 SHA-256，区别披露范围和编码',
    file_name VARCHAR(1024) NOT NULL COMMENT '签名中声明的作品文件名，不是已核对作品',
    artifact_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '证书声明的作品指纹，未读取作品',
    record_scope VARCHAR(16) NOT NULL COMMENT 'full 全部记录，selective 部分记录',
    disclosed_events BIGINT NOT NULL COMMENT '本次检查的操作数量',
    total_events BIGINT NOT NULL COMMENT '证书声明的操作总数量',
    demo TINYINT NOT NULL DEFAULT 0 COMMENT '演示数据标记',
    create_by VARCHAR(64) DEFAULT NULL COMMENT '提交账号',
    update_by VARCHAR(64) DEFAULT NULL COMMENT '更新账号',
    create_time DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '服务器保存时间，不是实际创作时间',
    update_time DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    PRIMARY KEY (id),
    UNIQUE KEY uk_wp_certificate_owner_proof (owner_user_id, proof_hash),
    KEY idx_wp_certificate_dept (dept_id, id),
    KEY idx_wp_certificate_identity (certificate_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='已通过内容检查的证书摘要，不保存作品或原始过程';

-- Existing sys_menu uses caller-assigned BIGINT IDs. Reserved WorkProof range.
-- A conflicting ID must fail rather than overwrite an unrelated menu.
INSERT INTO sys_menu (id,parent_id,menu_name,menu_type,icon,path,component,permission,sort,visible,status,create_by,update_by)
SELECT 81000,0,'证书管理','menu','file','/workproof/certificates','workproof/certificates/index','workproof:certificate:list',20,1,1,'workproof','workproof'
WHERE NOT EXISTS (SELECT 1 FROM sys_menu WHERE id=81000 AND component='workproof/certificates/index' AND permission='workproof:certificate:list');
INSERT INTO sys_menu (id,parent_id,menu_name,menu_type,permission,sort,visible,status,create_by,update_by)
SELECT 81001,81000,'保存证书','btn','workproof:certificate:add',1,1,1,'workproof','workproof'
WHERE NOT EXISTS (SELECT 1 FROM sys_menu WHERE id=81001 AND parent_id=81000 AND permission='workproof:certificate:add');
INSERT INTO sys_menu (id,parent_id,menu_name,menu_type,permission,sort,visible,status,create_by,update_by)
SELECT 81002,81000,'导出证书列表','btn','workproof:certificate:export',2,1,1,'workproof','workproof'
WHERE NOT EXISTS (SELECT 1 FROM sys_menu WHERE id=81002 AND parent_id=81000 AND permission='workproof:certificate:export');
INSERT INTO sys_menu (id,parent_id,menu_name,menu_type,permission,sort,visible,status,create_by,update_by)
SELECT 81003,81000,'检查证书内容','btn','workproof:certificate:inspect',3,1,1,'workproof','workproof'
WHERE NOT EXISTS (SELECT 1 FROM sys_menu WHERE id=81003 AND parent_id=81000 AND permission='workproof:certificate:inspect');
