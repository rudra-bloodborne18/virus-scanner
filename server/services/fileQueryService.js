import pool from '../config/db.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(path.dirname(__filename));

export const getAllFilesService = async (query, user) => {
  if (!user || !user.uid) {
    throw new Error('User not authenticated');
  }
  
  const { fileId, filename, mimeType, status, limit = 10, page = 1, date } = query;
  const userId = user.uid;

  let sql = `SELECT f.*, s.status AS scan_status, s.virus_name, s.scan_log, s.scan_version as clamav_version FROM files f LEFT JOIN scans s ON f.id = s.file_id`;
  let countSql = `SELECT COUNT(*) FROM files f LEFT JOIN scans s ON f.id = s.file_id`;
  
  const conditions = [`f.user_id = $1`];
  const params = [userId];
  let idx = 2;

  if (fileId) {
    conditions.push(`f.id = $${idx++}`);
    params.push(fileId);
  }
  if (filename) {
    conditions.push(`f.filename ILIKE $${idx++}`);
    params.push(`%${filename}%`);
  }
  if (mimeType) {
    conditions.push(`LOWER(f.mime_type) LIKE $${idx++}`);
    params.push(`%${mimeType.toLowerCase()}%`);
  }
  if (status && status !== 'all') {
    if (status === 'unscanned') {
      conditions.push(`s.status IS NULL`);
    } else {
      conditions.push(`s.status = $${idx++}`);
      params.push(status);
    }
  }
  if (date) {
    conditions.push(`DATE(f.uploaded_at) = $${idx++}`);
    params.push(date);
  }

  if (conditions.length > 0) {
    sql += ` WHERE ${conditions.join(' AND ')}`;
    countSql += ` WHERE ${conditions.join(' AND ')}`;
  }

  const offset = (page - 1) * limit;
  const countParams = [...params];
  sql += ` ORDER BY f.uploaded_at DESC LIMIT $${idx++} OFFSET $${idx++}`;
  params.push(limit, offset);

  const allFiles = await pool.query(sql, params);
  const totalCount = await pool.query(countSql, countParams);

  return {
    files: allFiles.rows,
    total: parseInt(totalCount.rows[0].count) || 0
  };
};

export const getFileById = async (fileId, user) => {
    if (!user || !user.uid) {
      throw new Error('User not authenticated');
    }
    const fileResult = await pool.query('SELECT * FROM files WHERE id = $1 AND user_id = $2', [fileId, user.uid]);
    if (fileResult.rows.length === 0) {
        throw new Error('File not found or access denied');
    }
    const file = fileResult.rows[0];
    const filePath = path.join(__dirname, '..', 'uploads', file.filename);
    return { file, filePath };
};

export const deleteFileById = async (fileId, user) => {
    const { file, filePath } = await getFileById(fileId, user);
    try {
        console.log(`[deleteFileById] Attempting to delete file from disk: ${filePath}`);
        await fs.promises.unlink(filePath);
        console.log(`[deleteFileById] Deleted file from disk: ${filePath}`);
    } catch (err) {
        if (err.code === 'ENOENT') {
            // File already deleted, not an error
            console.log(`[deleteFileById] File not found on disk (already deleted): ${filePath}`);
        } else {
            console.error(`[deleteFileById] Error deleting file from disk: ${filePath}`, err);
        }
    }
    await pool.query('DELETE FROM files WHERE id = $1 AND user_id = $2', [fileId, user.uid]);
    // Also delete associated scans
    await pool.query('DELETE FROM scans WHERE file_id = $1', [fileId]);
};

// export const getScanStatistics = async (user) => {
//     if (!user || !user.uid) {
//       throw new Error('User not authenticated');
//     }
//     const statsResult = await pool.query(`
//         SELECT
//             COUNT(f.id) AS total,
//             SUM(CASE WHEN s.status = 'clean' THEN 1 ELSE 0 END) AS clean,
//             SUM(CASE WHEN s.status = 'infected' THEN 1 ELSE 0 END) AS infected
//         FROM files f
//         LEFT JOIN scans s ON f.id = s.file_id
//         WHERE f.user_id = $1
//     `, [user.uid]);
//     const stats = statsResult.rows[0];
//     return {
//         total: parseInt(stats.total, 10) || 0,
//         clean: parseInt(stats.clean, 10) || 0,
//         infected: parseInt(stats.infected, 10) || 0,
//     };
// };

export const getInfectedFiles = async (user) => {
    if (!user || !user.uid) {
      throw new Error('User not authenticated');
    }
    const result = await pool.query(`
        SELECT f.id FROM files f
        LEFT JOIN scans s ON f.id = s.file_id
        WHERE s.status = 'infected' AND f.user_id = $1
    `, [user.uid]);
    return result.rows;
};

export const getScanStatisticsService = async (user) => {
  if (!user || !user.uid) {
    throw new Error('User not authenticated');
  }
  const statsResult = await pool.query(`
    SELECT
      COUNT(f.id) AS total,
      SUM(CASE WHEN s.status = 'clean' THEN 1 ELSE 0 END) AS clean,
      SUM(CASE WHEN s.status = 'infected' THEN 1 ELSE 0 END) AS infected
    FROM files f
    LEFT JOIN scans s ON f.id = s.file_id
    WHERE f.user_id = $1
  `, [user.uid]);
  const stats = statsResult.rows[0];
  return {
    total: parseInt(stats.total, 10) || 0,
    clean: parseInt(stats.clean, 10) || 0,
    infected: parseInt(stats.infected, 10) || 0,
  };
};