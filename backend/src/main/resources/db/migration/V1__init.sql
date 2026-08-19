CREATE TABLE visitor_log
(
    id         BIGINT       NOT NULL AUTO_INCREMENT,
    ip         VARCHAR(64)  NOT NULL COMMENT '访客 IP',
    page       VARCHAR(128) NOT NULL DEFAULT '/' COMMENT '访问页面',
    user_agent VARCHAR(512) NULL COMMENT '浏览器 UA',
    created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_created_at (created_at),
    KEY idx_ip (ip)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_unicode_ci COMMENT ='访客访问明细';

CREATE TABLE ai_mock_config
(
    id           INT          NOT NULL AUTO_INCREMENT,
    config_key   VARCHAR(64)  NOT NULL,
    config_value VARCHAR(512) NULL,
    remark       VARCHAR(255) NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uk_config_key (config_key)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_unicode_ci COMMENT ='AI 接入预留配置';

INSERT INTO ai_mock_config (config_key, config_value, remark)
VALUES ('provider', 'mock', '预留：接入真实模型后改为实际 provider'),
       ('api_key', '', '预留：真实模型 API Key');
