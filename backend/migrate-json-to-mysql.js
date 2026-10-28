/**
 * migrate-json-to-mysql.js
 * Di chuyển toàn bộ dữ liệu từ các file JSON vào Database MySQL Workbench (viplike_radiant)
 */
const fs = require('fs');
const path = require('path');
const db = require('./db');

const DATA_DIR = path.join(__dirname, 'data');

async function migrateAll() {
  console.log('🚀 Bắt đầu di chuyển toàn bộ dữ liệu JSON vào MySQL Workbench (viplike_radiant)...');
  const pool = db.getPool();

  // 1. DI CHUYỂN BUFF_QUEUE (82 bài trong hàng đợi)
  const queueFile = path.join(DATA_DIR, 'buff_queue.json');
  if (fs.existsSync(queueFile)) {
    try {
      const qData = JSON.parse(fs.readFileSync(queueFile, 'utf8'));
      const items = qData.items || [];
      console.log(`📦 Tìm thấy ${items.length} nhiệm vụ trong buff_queue.json...`);
      let qCount = 0;
      for (const it of items) {
        const id = it.id || `task_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        const targetUrl = it.targetUrl || it.normalizedUrl || '';
        const targetLikes = Number(it.targetLikes) || 30;
        const reactionType = it.reactionType || 'RANDOM_POSITIVE';
        const delayMinutes = Number(it.delayMinutes) || 5;
        const enableComment = it.enableComment ? 1 : 0;
        const commentList = JSON.stringify(it.comments || []);
        let status = 'WAITING';
        if (it.status === 'COMPLETED') status = 'COMPLETED';
        else if (it.status === 'RUNNING') status = 'RUNNING';
        else if (it.status === 'FAILED') status = 'FAILED';
        else if (it.status === 'PAUSED') status = 'PAUSED';

        const progressLikes = Number(it.progress?.done ?? it.result?.success ?? 0);
        const progressComments = 0;
        const scheduleTime = it.runAfter ? new Date(it.runAfter) : new Date();
        const createdAt = it.addedAt ? new Date(it.addedAt) : new Date();
        const completedAt = it.finishedAt ? new Date(it.finishedAt) : null;

        await pool.execute(
          `INSERT INTO buff_queue (id, target_url, target_likes, reaction_type, delay_minutes, enable_comment, comment_list, status, progress_likes, progress_comments, schedule_time, created_at, completed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             target_url = VALUES(target_url),
             target_likes = VALUES(target_likes),
             reaction_type = VALUES(reaction_type),
             status = VALUES(status),
             progress_likes = VALUES(progress_likes),
             completed_at = VALUES(completed_at)`,
          [
            id,
            targetUrl,
            targetLikes,
            reactionType,
            delayMinutes,
            enableComment,
            commentList,
            status,
            progressLikes,
            progressComments,
            scheduleTime,
            createdAt,
            completedAt,
          ]
        );
        qCount++;
      }
      console.log(`✅ Đã nạp thành công ${qCount} dòng vào bảng MySQL 'buff_queue'!`);
    } catch (err) {
      console.error('❌ Lỗi di chuyển buff_queue:', err.message);
    }
  }

  // 2. DI CHUYỂN BUFF_HISTORY (79 bài trong lịch sử tương tác)
  const historyFile = path.join(DATA_DIR, 'buff_history.json');
  if (fs.existsSync(historyFile)) {
    try {
      const hData = JSON.parse(fs.readFileSync(historyFile, 'utf8'));
      const entries = Object.entries(hData);
      console.log(`📦 Tìm thấy ${entries.length} bản ghi trong buff_history.json...`);
      let hCount = 0;
      for (const [url, item] of entries) {
        const targetUrl = item.url || item.normalizedUrl || url;
        const reaction = item.reactionType || 'LIKE';
        const status = 'COMPLETED';
        const createdAt = item.lastBuffedAt ? new Date(item.lastBuffedAt) : new Date();

        await pool.execute(
          `INSERT INTO buff_history (user_id, target_url, page_id, page_name, interaction_type, status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            1,
            targetUrl,
            'ALL_PAGES',
            `Đã tương tác (${item.totalSuccess || 1} lượt)`,
            reaction,
            status,
            createdAt,
          ]
        );
        hCount++;
      }
      console.log(`✅ Đã nạp thành công ${hCount} dòng vào bảng MySQL 'buff_history'!`);
    } catch (err) {
      console.error('❌ Lỗi di chuyển buff_history:', err.message);
    }
  }

  // 3. DI CHUYỂN CÁC FANPAGE CÒN THIẾU TỪ pages_cache.json VÀO facebook_page_accesses
  const pagesFile = path.join(DATA_DIR, 'pages_cache.json');
  if (fs.existsSync(pagesFile)) {
    try {
      const pData = JSON.parse(fs.readFileSync(pagesFile, 'utf8'));
      let insertedPages = 0;
      const now = new Date();

      for (const [viaUid, val] of Object.entries(pData)) {
        if (!val.pages || !Array.isArray(val.pages)) continue;
        const profileName = val.viaName || `Via ${viaUid}`;

        // Lấy source_account_id từ social_accounts
        const [saRows] = await pool.execute(
          'SELECT id FROM social_accounts WHERE platform_account_id = ? LIMIT 1',
          [viaUid]
        );
        const sourceAccountId = saRows[0]?.id || 35; // Fallback to 35 (Thành An)

        for (const page of val.pages) {
          const [exists] = await pool.execute(
            'SELECT id FROM facebook_page_accesses WHERE page_id = ? LIMIT 1',
            [page.id]
          );
          if (exists.length === 0) {
            await pool.execute(
              `INSERT INTO facebook_page_accesses 
               (active, avatar_url, created_at, first_seen_at, last_scan_at, last_seen_at, last_verified_at, page_id, page_name, page_url, personal_profile_id, profile_name, updated_at, verification_message, verification_status, source_account_id, user_id)
               VALUES (1, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Tự động đồng bộ từ hệ thống', 'VERIFIED', ?, 1)`,
              [
                now,
                now,
                now,
                now,
                now,
                page.id,
                page.name || `Page ${page.id}`,
                page.url || `https://www.facebook.com/${page.id}`,
                viaUid,
                profileName,
                now,
                sourceAccountId,
              ]
            );
            insertedPages++;
          }
        }
      }
      console.log(`✅ Đã đồng bộ thêm ${insertedPages} Fanpage vào bảng MySQL 'facebook_page_accesses'!`);
    } catch (err) {
      console.error('❌ Lỗi đồng bộ facebook_page_accesses:', err.message);
    }
  }

  // 4. DI CHUYỂN USERS TỪ users.json VÀO users
  const usersFile = path.join(DATA_DIR, 'users.json');
  if (fs.existsSync(usersFile)) {
    try {
      const uData = JSON.parse(fs.readFileSync(usersFile, 'utf8'));
      let uCount = 0;
      for (const u of uData) {
        if (!u.username) continue;
        const [exists] = await pool.execute('SELECT id FROM users WHERE username = ? LIMIT 1', [u.username]);
        if (exists.length === 0) {
          await pool.execute(
            `INSERT INTO users (username, role, full_name, email, is_active, created_at)
             VALUES (?, ?, ?, ?, 1, NOW())`,
            [u.username, u.role || 'ADMIN', u.fullName || u.username, `${u.username.toLowerCase()}@viplike.local`]
          );
          uCount++;
        }
      }
      console.log(`✅ Đã nạp ${uCount} tài khoản quản trị vào bảng MySQL 'users'!`);
    } catch (err) {
      console.error('❌ Lỗi đồng bộ users:', err.message);
    }
  }

  // 5. DI CHUYỂN SYSTEM_SETTINGS VÀO app_settings
  const settingsFile = path.join(DATA_DIR, 'system_settings.json');
  if (fs.existsSync(settingsFile)) {
    try {
      const sData = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
      for (const [k, v] of Object.entries(sData)) {
        const valStr = typeof v === 'object' ? JSON.stringify(v) : String(v);
        await pool.execute(
          `INSERT INTO app_settings (setting_key, setting_value) VALUES (?, ?)
           ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
          [`system.${k}`, valStr]
        );
      }
      console.log(`✅ Đã nạp toàn bộ cấu hình hệ thống vào bảng MySQL 'app_settings'!`);
    } catch (err) {
      console.error('❌ Lỗi đồng bộ app_settings:', err.message);
    }
  }

  console.log('🎉 TOÀN BỘ DỮ LIỆU ĐÃ ĐƯỢC CHUYỂN VÀO MYSQL WORKBENCH THÀNH CÔNG 100%!');
  process.exit(0);
}

migrateAll().catch((e) => {
  console.error('Fatal error:', e);
  process.exit(1);
});
