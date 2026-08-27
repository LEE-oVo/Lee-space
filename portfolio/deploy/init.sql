-- =====================================================
-- 个人作品网站 数据库初始化脚本（MySQL 8.0）
-- 用法：
--   Docker：compose 自动挂载到 /docker-entrypoint-initdb.d，首次启动执行
--   手动：  mysql -uroot -p < init.sql
-- 初始管理员：admin / 123456（登录后请立即修改密码）
-- =====================================================

CREATE DATABASE IF NOT EXISTS portfolio_db
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE portfolio_db;

-- 管理员账号（单账号，无注册功能）
CREATE TABLE IF NOT EXISTS admin_user (
  id          BIGINT       NOT NULL AUTO_INCREMENT,
  username    VARCHAR(50)  NOT NULL COMMENT '登录用户名',
  password    VARCHAR(100) NOT NULL COMMENT 'BCrypt 加密后的密码',
  create_time DATETIME     DEFAULT NULL,
  update_time DATETIME     DEFAULT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_username (username)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '管理员账号';

-- 文件作品（PDF / HTML）
CREATE TABLE IF NOT EXISTS portfolio_file (
  id            BIGINT       NOT NULL AUTO_INCREMENT,
  title         VARCHAR(200) NOT NULL COMMENT '文件标题',
  intro         VARCHAR(500) DEFAULT '' COMMENT '简介',
  file_type     VARCHAR(10)  NOT NULL COMMENT '文件类型：pdf / html',
  file_path     VARCHAR(255) NOT NULL COMMENT '存储路径（相对上传根目录）',
  original_name VARCHAR(255) DEFAULT NULL COMMENT '原始文件名',
  file_size     BIGINT       DEFAULT 0 COMMENT '文件大小（字节）',
  create_time   DATETIME     DEFAULT NULL,
  update_time   DATETIME     DEFAULT NULL,
  PRIMARY KEY (id),
  KEY idx_create_time (create_time)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '文件作品';

-- 视频作品（MP4 + 缩略图）
CREATE TABLE IF NOT EXISTS portfolio_video (
  id          BIGINT       NOT NULL AUTO_INCREMENT,
  title       VARCHAR(200) NOT NULL COMMENT '视频标题',
  intro       VARCHAR(500) DEFAULT '' COMMENT '简介',
  video_path  VARCHAR(255) NOT NULL COMMENT '视频存储路径',
  thumb_path  VARCHAR(255) DEFAULT NULL COMMENT '缩略图存储路径',
  video_size  BIGINT       DEFAULT 0 COMMENT '视频大小（字节）',
  create_time DATETIME     DEFAULT NULL,
  update_time DATETIME     DEFAULT NULL,
  PRIMARY KEY (id),
  KEY idx_create_time (create_time)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '视频作品';

-- 初始管理员：admin / 123456（BCrypt）
INSERT INTO admin_user (username, password, create_time, update_time)
SELECT 'admin', '$2a$10$M4mr1W1xSocytGjBYcfCEOWViygs.KJ5GKGnBrAj9eOctu/959apW', NOW(), NOW()
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM admin_user WHERE username = 'admin');
