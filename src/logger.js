/**
 * Logger Module
 * 
 * Saves all console output to log files while maintaining console display.
 * Features:
 * - Dual output (console + file)
 * - Timestamps for all logs
 * - Automatic log rotation by date
 * - Color codes preserved in console, stripped in file
 * - Separate error logs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class Logger {
  constructor(logDir = './logs') {
    this.logDir = logDir;
    this.ensureLogDirectory();
    
    // Store original console methods
    this.originalConsole = {
      log: console.log,
      error: console.error,
      warn: console.warn,
      info: console.info,
      debug: console.debug
    };
    
    // Current log files
    this.currentDate = this.getDateString();
    this.logFile = this.getLogFilePath('bot');
    this.errorFile = this.getLogFilePath('error');
    
    // Track if we've already intercepted console
    this.isIntercepted = false;
  }

  ensureLogDirectory() {
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }

  getDateString() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  getLogFilePath(type) {
    return path.join(this.logDir, `${type}-${this.currentDate}.log`);
  }

  getTimestamp() {
    const now = new Date();
    return now.toISOString();
  }

  stripColorCodes(text) {
    // Remove ANSI color codes for file output
    return String(text).replace(/\x1b\[[0-9;]*m/g, '');
  }

  formatLogEntry(level, args) {
    const timestamp = this.getTimestamp();
    const message = args.map(arg => {
      if (typeof arg === 'object') {
        try {
          return JSON.stringify(arg, null, 2);
        } catch (e) {
          return String(arg);
        }
      }
      return String(arg);
    }).join(' ');
    
    return `[${timestamp}] [${level}] ${this.stripColorCodes(message)}`;
  }

  writeToFile(filepath, content) {
    try {
      // Check if date has changed, update log file paths
      const currentDate = this.getDateString();
      if (currentDate !== this.currentDate) {
        this.currentDate = currentDate;
        this.logFile = this.getLogFilePath('bot');
        this.errorFile = this.getLogFilePath('error');
      }

      fs.appendFileSync(filepath, content + '\n', 'utf8');
    } catch (error) {
      // If we can't write to log, at least show in console
      this.originalConsole.error('Failed to write to log file:', error.message);
    }
  }

  log(...args) {
    // Write to console with original colors
    this.originalConsole.log(...args);
    
    // Write to file without colors
    const logEntry = this.formatLogEntry('INFO', args);
    this.writeToFile(this.logFile, logEntry);
  }

  error(...args) {
    // Write to console
    this.originalConsole.error(...args);
    
    // Write to both main log and error log
    const logEntry = this.formatLogEntry('ERROR', args);
    this.writeToFile(this.logFile, logEntry);
    this.writeToFile(this.errorFile, logEntry);
  }

  warn(...args) {
    // Write to console
    this.originalConsole.warn(...args);
    
    // Write to file
    const logEntry = this.formatLogEntry('WARN', args);
    this.writeToFile(this.logFile, logEntry);
  }

  info(...args) {
    // Write to console
    this.originalConsole.info(...args);
    
    // Write to file
    const logEntry = this.formatLogEntry('INFO', args);
    this.writeToFile(this.logFile, logEntry);
  }

  debug(...args) {
    // Write to console
    this.originalConsole.debug(...args);
    
    // Write to file
    const logEntry = this.formatLogEntry('DEBUG', args);
    this.writeToFile(this.logFile, logEntry);
  }

  /**
   * Intercept all console methods to log to file
   */
  interceptConsole() {
    if (this.isIntercepted) {
      return; // Already intercepted
    }

    console.log = (...args) => this.log(...args);
    console.error = (...args) => this.error(...args);
    console.warn = (...args) => this.warn(...args);
    console.info = (...args) => this.info(...args);
    console.debug = (...args) => this.debug(...args);

    this.isIntercepted = true;
    
    // Log that logging has started
    this.log('='.repeat(80));
    this.log('🤖 Polymarket Trading Bot - Logging Started');
    this.log(`📝 Log file: ${this.logFile}`);
    this.log(`❌ Error log: ${this.errorFile}`);
    this.log('='.repeat(80));
  }

  /**
   * Restore original console methods
   */
  restoreConsole() {
    if (!this.isIntercepted) {
      return;
    }

    console.log = this.originalConsole.log;
    console.error = this.originalConsole.error;
    console.warn = this.originalConsole.warn;
    console.info = this.originalConsole.info;
    console.debug = this.originalConsole.debug;

    this.isIntercepted = false;
    
    this.originalConsole.log('Console logging restored to original');
  }

  /**
   * Get list of all log files
   */
  getLogFiles() {
    try {
      const files = fs.readdirSync(this.logDir);
      return files
        .filter(f => f.endsWith('.log'))
        .map(f => ({
          name: f,
          path: path.join(this.logDir, f),
          size: fs.statSync(path.join(this.logDir, f)).size,
          modified: fs.statSync(path.join(this.logDir, f)).mtime
        }))
        .sort((a, b) => b.modified - a.modified);
    } catch (error) {
      return [];
    }
  }

  /**
   * Clean up old log files (older than X days)
   */
  cleanOldLogs(daysToKeep = 30) {
    try {
      const files = fs.readdirSync(this.logDir);
      const now = Date.now();
      const maxAge = daysToKeep * 24 * 60 * 60 * 1000; // Convert days to ms
      
      let deletedCount = 0;
      
      files.forEach(file => {
        if (!file.endsWith('.log')) return;
        
        const filepath = path.join(this.logDir, file);
        const stats = fs.statSync(filepath);
        const age = now - stats.mtime.getTime();
        
        if (age > maxAge) {
          fs.unlinkSync(filepath);
          deletedCount++;
          this.log(`Deleted old log file: ${file}`);
        }
      });
      
      if (deletedCount > 0) {
        this.log(`Cleaned up ${deletedCount} old log file(s)`);
      }
      
      return deletedCount;
    } catch (error) {
      this.error('Error cleaning old logs:', error.message);
      return 0;
    }
  }

  /**
   * Get log file statistics
   */
  getStats() {
    const files = this.getLogFiles();
    const totalSize = files.reduce((sum, f) => sum + f.size, 0);
    
    return {
      totalFiles: files.length,
      totalSizeBytes: totalSize,
      totalSizeMB: (totalSize / (1024 * 1024)).toFixed(2),
      currentLogFile: this.logFile,
      currentErrorFile: this.errorFile,
      files: files
    };
  }
}

// Create and export singleton instance
const logger = new Logger('./logs');

export default logger;
