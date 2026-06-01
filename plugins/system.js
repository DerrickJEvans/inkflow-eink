const fs = require('fs');
const { exec } = require('child_process');

// Helper to run shell commands in a promise
const runCmd = (cmd) => {
  return new Promise((resolve) => {
    exec(cmd, (err, stdout) => {
      if (err) resolve('');
      else resolve(stdout.trim());
    });
  });
};

// Calculate CPU Usage by reading /proc/stat
let lastCpuStats = { idle: 0, total: 0 };
const getCpuUsage = async () => {
  try {
    if (process.platform !== 'linux') {
      return Math.floor(10 + Math.random() * 15); // Mock usage
    }
    const statStr = fs.readFileSync('/proc/stat', 'utf8').split('\n')[0];
    const parts = statStr.split(/\s+/).slice(1).map(Number);
    const idle = parts[3];
    const total = parts.reduce((sum, val) => sum + val, 0);

    const idleDiff = idle - lastCpuStats.idle;
    const totalDiff = total - lastCpuStats.total;
    lastCpuStats = { idle, total };

    if (totalDiff === 0) return 0;
    return Math.floor(100 * (1 - idleDiff / totalDiff));
  } catch (e) {
    return 12; // Fallback
  }
};

module.exports = {
  id: "system",
  name: "System Telemetry",
  description: "Monitors Raspberry Pi health (CPU, RAM, Temp, Disk, Uptime).",
  configFields: [], // No custom config required for local host telemetry

  async fetchData(settings) {
    let cpuTemp = "42.5";
    let ramUsage = 35; // %
    let ramText = "1.2GB / 4.0GB";
    let diskUsage = 28; // %
    let diskText = "16GB / 64GB";
    let uptime = "3d 4h 12m";
    let uptimeRaw = 274320; // Default mock uptime in seconds (3d 4h 12m)

    try {
      if (process.platform === 'linux') {
        // Temperature
        if (fs.existsSync('/sys/class/thermal/thermal_zone0/temp')) {
          const tempRaw = fs.readFileSync('/sys/class/thermal/thermal_zone0/temp', 'utf8');
          cpuTemp = (parseInt(tempRaw) / 1000).toFixed(1);
        } else {
          const vcgencmd = await runCmd('vcgencmd measure_temp');
          if (vcgencmd) {
            cpuTemp = vcgencmd.replace('temp=', '').replace("'C", '');
          }
        }

        // Memory usage from /proc/meminfo
        if (fs.existsSync('/proc/meminfo')) {
          const meminfo = fs.readFileSync('/proc/meminfo', 'utf8');
          const memTotal = parseInt(meminfo.match(/MemTotal:\s+(\d+)/)[1]);
          const memAvailable = parseInt(meminfo.match(/MemAvailable:\s+(\d+)/)[1]);
          const memUsed = memTotal - memAvailable;
          ramUsage = Math.floor((memUsed / memTotal) * 100);
          ramText = `${(memUsed / 1024 / 1024).toFixed(1)}G / ${(memTotal / 1024 / 1024).toFixed(0)}G`;
        }

        // Disk Usage
        const dfOut = await runCmd("df -k / | tail -n 1");
        if (dfOut) {
          const cols = dfOut.split(/\s+/);
          const totalK = parseInt(cols[1]);
          const usedK = parseInt(cols[2]);
          diskUsage = Math.floor((usedK / totalK) * 100);
          diskText = `${(usedK / 1024 / 1024).toFixed(1)}G / ${(totalK / 1024 / 1024).toFixed(0)}G`;
        }

        // Uptime
        if (fs.existsSync('/proc/uptime')) {
          uptimeRaw = parseFloat(fs.readFileSync('/proc/uptime', 'utf8').split(' ')[0]);
          const days = Math.floor(uptimeRaw / 86400);
          const hours = Math.floor((uptimeRaw % 86400) / 3600);
          const mins = Math.floor((uptimeRaw % 3600) / 60);
          uptime = `${days > 0 ? days + 'd ' : ''}${hours}h ${mins}m`;
        }
      }
    } catch (e) {
      console.error("Error gathering system metrics:", e);
    }

    const cpuUsage = await getCpuUsage();

    return {
      cpuUsage,
      cpuTemp,
      ramUsage,
      ramText,
      diskUsage,
      diskText,
      uptime,
      uptimeRaw
    };
  },

  renderSVG(data, width, height) {
    const padding = 20;
    const isFullScreen = height > 300;
    
    const drawProgressBar = (label, value, text, x, y, barWidth, barHeight = 12) => {
      return `
        <text x="${x}" y="${y}" font-family="sans-serif" font-size="13" font-weight="bold" fill="black">${label}</text>
        <text x="${x + barWidth}" y="${y}" font-family="sans-serif" font-size="12" text-anchor="end" fill="black">${text}</text>
        <rect x="${x}" y="${y + 8}" width="${barWidth}" height="${barHeight}" rx="${barHeight / 2}" fill="none" stroke="black" stroke-width="1.5" />
        <rect x="${x}" y="${y + 8}" width="${(barWidth * value) / 100}" height="${barHeight}" rx="${barHeight / 2}" fill="black" />
      `;
    };

    if (isFullScreen) {
      const halfWidth = (width - padding * 2 - 30) / 2;
      return `
        <g>
          <!-- Header -->
          <text x="${padding}" y="35" font-family="sans-serif" font-size="20" font-weight="bold" fill="black" letter-spacing="1">⚡ HOST SYSTEM TELEMETRY</text>
          <line x1="${padding}" y1="48" x2="${width - padding}" y2="48" stroke="black" stroke-width="2.5" />
          
          <!-- Top Row Status Cards -->
          <g transform="translate(${padding}, 70)">
            <!-- Uptime Card -->
            <g>
              <rect x="0" y="0" width="${halfWidth}" height="100" rx="10" fill="none" stroke="black" stroke-width="1.5" />
              <text x="20" y="30" font-family="sans-serif" font-size="12" font-weight="bold" fill="black" opacity="0.6">SYSTEM UPTIME</text>
              <text x="20" y="70" font-family="sans-serif" font-size="28" font-weight="bold" fill="black">${data.uptime}</text>
            </g>
            
            <!-- CPU Temp Card -->
            <g transform="translate(${halfWidth + 30}, 0)">
              <rect x="0" y="0" width="${halfWidth}" height="100" rx="10" fill="none" stroke="black" stroke-width="1.5" />
              <text x="20" y="30" font-family="sans-serif" font-size="12" font-weight="bold" fill="black" opacity="0.6">CPU TEMPERATURE</text>
              <text x="20" y="70" font-family="sans-serif" font-size="28" font-weight="bold" fill="black">${data.cpuTemp}°C</text>
            </g>
          </g>
          
          <!-- Resource Bars Section -->
          <g transform="translate(${padding}, 205)">
            <text x="0" y="0" font-family="sans-serif" font-size="15" font-weight="bold" fill="black" letter-spacing="0.5">📊 RESOURCE ALLOCATION</text>
            
            <g transform="translate(0, 20)">
              ${drawProgressBar("CPU Load Indicator", data.cpuUsage, `${data.cpuUsage}%`, 0, 10, width - padding * 2, 14)}
            </g>
            
            <g transform="translate(0, 85)">
              ${drawProgressBar("Active Memory (RAM)", data.ramUsage, data.ramText, 0, 10, width - padding * 2, 14)}
            </g>
            
            <g transform="translate(0, 150)">
              ${drawProgressBar("Disk Storage (/)", data.diskUsage, data.diskText, 0, 10, width - padding * 2, 14)}
            </g>
          </g>
        </g>
      `;
    } else {
      // Standard compact grid cell layout
      const barWidth = width - padding * 2 - 10;
      return `
        <g>
          <!-- Header -->
          <text x="${padding}" y="25" font-family="sans-serif" font-size="14" font-weight="bold" fill="black">⚡ SYSTEM HEALTH</text>
          <line x1="${padding}" y1="32" x2="${width - padding}" y2="32" stroke="black" stroke-width="1.5" />
          
          <!-- Metrics -->
          <text x="${padding}" y="52" font-family="sans-serif" font-size="12" fill="black">Uptime: <tspan font-weight="bold">${data.uptime}</tspan></text>
          <text x="${width - padding}" y="52" font-family="sans-serif" font-size="12" text-anchor="end" fill="black">Temp: <tspan font-weight="bold">${data.cpuTemp}°C</tspan></text>
          
          ${drawProgressBar("CPU Load", data.cpuUsage, `${data.cpuUsage}%`, padding, 74, barWidth, 8)}
          ${drawProgressBar("Memory", data.ramUsage, data.ramText, padding, 114, barWidth, 8)}
          ${drawProgressBar("Disk Space", data.diskUsage, data.diskText, padding, 154, barWidth, 8)}
        </g>
      `;
    }
  }
};
