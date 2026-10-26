-- =============================================================================
-- VIPLIKE RADIANT v2.0 - DATABASE SCHEMA CHO MYSQL WORKBENCH
-- Khởi tạo Database và Bảng lưu trữ Dàn Via, Fanpage, Lịch sử, Hàng Đợi & Users
-- =============================================================================

CREATE DATABASE IF NOT EXISTS `autopost_saas` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE `autopost_saas`;

-- 1. BẢNG USERS (HỆ THỐNG ĐĂNG NHẬP / TÀI KHOẢN QUẢN TRỊ)
CREATE TABLE IF NOT EXISTS `users` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `username` VARCHAR(64) NOT NULL UNIQUE,
  `email` VARCHAR(128) NOT NULL UNIQUE,
  `password_hash` VARCHAR(255) NOT NULL,
  `full_name` VARCHAR(128) NULL,
  `role` ENUM('ADMIN', 'USER') DEFAULT 'ADMIN',
  `status` ENUM('ACTIVE', 'BANNED') DEFAULT 'ACTIVE',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tạo tài khoản Admin mặc định (mật khẩu: admin123)
INSERT INTO `users` (`id`, `username`, `email`, `password_hash`, `full_name`, `role`)
VALUES (1, 'admin', 'admin@viplike.local', '$2a$10$wE99qF/0m0c3jO2V3vL7u.GZt.m6qF/0m0c3jO2V3vL7u.GZt.m6q', 'Quản Trị Viên VIPLIKE', 'ADMIN')
ON DUPLICATE KEY UPDATE `username` = `username`;

-- 2. BẢNG SOCIAL_ACCOUNTS (LƯU TRỮ DÀN VIA & COOKIE & PROXY)
CREATE TABLE IF NOT EXISTS `social_accounts` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `user_id` INT DEFAULT 1,
  `platform` VARCHAR(64) DEFAULT 'FACEBOOK_PROFILE',
  `platform_account_id` VARCHAR(128) NOT NULL,
  `access_token` TEXT NOT NULL,
  `page_name` VARCHAR(255) NOT NULL,
  `account_type` VARCHAR(64) DEFAULT 'PERSONAL_PROFILE_COOKIE',
  `proxy_url` VARCHAR(255) NULL,
  `token_status` VARCHAR(32) DEFAULT 'OK',
  `token_checked_at` TIMESTAMP NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `idx_user_platform` (`user_id`, `platform`),
  INDEX `idx_platform_account_id` (`platform_account_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. BẢNG BUFF_MONITORS (POST HUNTER - THEO DÕI SĂN BÀI MỚI TỰ ĐỘNG)
CREATE TABLE IF NOT EXISTS `buff_monitors` (
  `id` VARCHAR(64) PRIMARY KEY,
  `user_id` INT DEFAULT 1,
  `target_type` ENUM('PAGE', 'GROUP', 'PROFILE') DEFAULT 'PAGE',
  `target_name` VARCHAR(255) NOT NULL,
  `target_url` TEXT NOT NULL,
  `target_likes` VARCHAR(32) DEFAULT 'ALL',
  `reaction_type` VARCHAR(32) DEFAULT 'RANDOM_POSITIVE',
  `delay_minutes` INT DEFAULT 0,
  `scan_interval_minutes` INT DEFAULT 10,
  `via_mode` VARCHAR(32) DEFAULT 'ALL_VIAS',
  `enable_comment` BOOLEAN DEFAULT FALSE,
  `comment_list` JSON NULL,
  `is_active` BOOLEAN DEFAULT TRUE,
  `last_scanned_at` TIMESTAMP NULL,
  `total_posts_found` INT DEFAULT 0,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. BẢNG BUFF_QUEUE (HÀNG ĐỢI TỰ ĐỘNG BUFFER WORKER)
CREATE TABLE IF NOT EXISTS `buff_queue` (
  `id` VARCHAR(64) PRIMARY KEY,
  `target_url` TEXT NOT NULL,
  `target_likes` INT DEFAULT 30,
  `reaction_type` VARCHAR(32) DEFAULT 'RANDOM_POSITIVE',
  `delay_minutes` INT DEFAULT 0,
  `enable_comment` BOOLEAN DEFAULT FALSE,
  `comment_list` JSON NULL,
  `status` ENUM('WAITING', 'RUNNING', 'COMPLETED', 'FAILED', 'PAUSED') DEFAULT 'WAITING',
  `progress_likes` INT DEFAULT 0,
  `progress_comments` INT DEFAULT 0,
  `schedule_time` TIMESTAMP NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `completed_at` TIMESTAMP NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5. BẢNG BUFF_HISTORY (SỔ CHỐNG TRÙNG LẶP & LỊCH SỬ TƯƠNG TÁC)
CREATE TABLE IF NOT EXISTS `buff_history` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `user_id` INT DEFAULT 1,
  `target_url` TEXT NOT NULL,
  `page_id` VARCHAR(128) NOT NULL,
  `page_name` VARCHAR(255) NOT NULL,
  `interaction_type` VARCHAR(32) NOT NULL,
  `status` VARCHAR(32) NOT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_history_url_page` (`target_url`(191), `page_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SELECT 'Khởi tạo Database autopost_saas cho VIPLIKE RADIANT thành công!' AS result;
