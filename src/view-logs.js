#!/usr/bin/env node

/**
 * Log Viewer Utility
 * 
 * View and manage bot log files
 * Usage:
 *   node src/view-logs.js           - List all log files
 *   node src/view-logs.js latest    - Show latest log file
 *   node src/view-logs.js today     - Show today's log
 *   node src/view-logs.js errors    - Show today's errors
 *   node src/view-logs.js stats     - Show log statistics
 *   node src/view-logs.js clean     - Clean old logs (30+ days)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from './logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  blue: '\x1b[34m'
};

function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

function listLogs() {
  console.log(`${colors.bright}${colors.cyan}📋 Available Log Files${colors.reset}\n`);
  
  const files = logger.getLogFiles();
  
  if (files.length === 0) {
    console.log(`${colors.yellow}No log files found${colors.reset}`);
    return;
  }
  
  files.forEach((file, idx) => {
    const isError = file.name.includes('error');
    const icon = isError ? '❌' : '📝';
    const color = isError ? colors.red : colors.green;
    
    console.log(`${color}${icon} ${file.name}${colors.reset}`);
    console.log(`   Size: ${formatBytes(file.size)}`);
    console.log(`   Modified: ${file.modified.toLocaleString()}`);
    console.log('');
  });
  
  console.log(`${colors.cyan}Total: ${files.length} file(s)${colors.reset}`);
}

function showLatest() {
  const files = logger.getLogFiles();
  
  if (files.length === 0) {
    console.log(`${colors.yellow}No log files found${colors.reset}`);
    return;
  }
  
  const latest = files[0];
  console.log(`${colors.bright}${colors.cyan}📖 Latest Log: ${latest.name}${colors.reset}\n`);
  
  try {
    const content = fs.readFileSync(latest.path, 'utf8');
    const lines = content.split('\n');
    const lastLines = lines.slice(-50).filter(l => l.trim()); // Last 50 non-empty lines
    
    console.log(lastLines.join('\n'));
  } catch (error) {
    console.error(`${colors.red}Error reading log file: ${error.message}${colors.reset}`);
  }
}

function showToday() {
  const dateStr = logger.getDateString();
  const todayLog = path.join(logger.logDir, `bot-${dateStr}.log`);
  
  if (!fs.existsSync(todayLog)) {
    console.log(`${colors.yellow}No log file for today (${dateStr})${colors.reset}`);
    return;
  }
  
  console.log(`${colors.bright}${colors.cyan}📅 Today's Log (${dateStr})${colors.reset}\n`);
  
  try {
    const content = fs.readFileSync(todayLog, 'utf8');
    console.log(content);
  } catch (error) {
    console.error(`${colors.red}Error reading log file: ${error.message}${colors.reset}`);
  }
}

function showErrors() {
  const dateStr = logger.getDateString();
  const errorLog = path.join(logger.logDir, `error-${dateStr}.log`);
  
  if (!fs.existsSync(errorLog)) {
    console.log(`${colors.green}✅ No errors logged today!${colors.reset}`);
    return;
  }
  
  console.log(`${colors.bright}${colors.red}❌ Today's Errors (${dateStr})${colors.reset}\n`);
  
  try {
    const content = fs.readFileSync(errorLog, 'utf8');
    console.log(content);
  } catch (error) {
    console.error(`${colors.red}Error reading error log: ${error.message}${colors.reset}`);
  }
}

function showStats() {
  console.log(`${colors.bright}${colors.cyan}📊 Log Statistics${colors.reset}\n`);
  
  const stats = logger.getStats();
  
  console.log(`${colors.green}Total Files:${colors.reset} ${stats.totalFiles}`);
  console.log(`${colors.green}Total Size:${colors.reset} ${stats.totalSizeMB} MB (${stats.totalSizeBytes.toLocaleString()} bytes)`);
  console.log(`${colors.green}Current Log:${colors.reset} ${stats.currentLogFile}`);
  console.log(`${colors.green}Error Log:${colors.reset} ${stats.currentErrorFile}`);
  console.log('');
  
  if (stats.files.length > 0) {
    console.log(`${colors.cyan}Recent Files:${colors.reset}`);
    stats.files.slice(0, 5).forEach(file => {
      console.log(`  • ${file.name} (${formatBytes(file.size)})`);
    });
  }
}

function cleanOldLogs() {
  console.log(`${colors.yellow}🧹 Cleaning old log files...${colors.reset}\n`);
  
  const deleted = logger.cleanOldLogs(30);
  
  if (deleted > 0) {
    console.log(`${colors.green}✅ Deleted ${deleted} old log file(s)${colors.reset}`);
  } else {
    console.log(`${colors.green}✅ No old log files to clean${colors.reset}`);
  }
}

// Main
const command = process.argv[2] || 'list';

console.log('');

switch (command.toLowerCase()) {
  case 'list':
  case 'ls':
    listLogs();
    break;
  
  case 'latest':
  case 'last':
    showLatest();
    break;
  
  case 'today':
    showToday();
    break;
  
  case 'errors':
  case 'error':
    showErrors();
    break;
  
  case 'stats':
  case 'info':
    showStats();
    break;
  
  case 'clean':
  case 'cleanup':
    cleanOldLogs();
    break;
  
  default:
    console.log(`${colors.red}Unknown command: ${command}${colors.reset}\n`);
    console.log(`${colors.cyan}Available commands:${colors.reset}`);
    console.log('  list    - List all log files');
    console.log('  latest  - Show latest log file (last 50 lines)');
    console.log('  today   - Show today\'s complete log');
    console.log('  errors  - Show today\'s errors');
    console.log('  stats   - Show log statistics');
    console.log('  clean   - Clean old logs (30+ days)');
}

console.log('');
