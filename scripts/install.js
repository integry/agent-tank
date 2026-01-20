#!/usr/bin/env node

const { execSync } = require('child_process');
const os = require('os');

function checkPythonVersion() {
  const pythonVersions = ['python3.11', 'python3.10', 'python3.9', 'python3.8', 'python3'];

  for (const python of pythonVersions) {
    try {
      const version = execSync(`${python} --version 2>&1`, { encoding: 'utf-8' }).trim();
      const match = version.match(/Python (\d+)\.(\d+)\.(\d+)/);

      if (match) {
        const major = parseInt(match[1]);
        const minor = parseInt(match[2]);

        if (major === 3 && minor >= 8) {
          console.log(`✓ Found ${version} at ${python}`);
          process.env.PYTHON = python;
          return true;
        }
      }
    } catch (e) {
      // Python version not found, try next
    }
  }

  return false;
}

function checkBuildTools() {
  const platform = os.platform();
  const missing = [];

  if (platform === 'linux') {
    // Check for gcc/g++
    try {
      execSync('which gcc', { stdio: 'ignore' });
    } catch (e) {
      missing.push('gcc');
    }

    try {
      execSync('which g++', { stdio: 'ignore' });
    } catch (e) {
      missing.push('g++');
    }

    try {
      execSync('which make', { stdio: 'ignore' });
    } catch (e) {
      missing.push('make');
    }

    // Check for node headers
    try {
      const nodeVersion = process.version.match(/v(\d+)/)[1];
      execSync(`ls /usr/include/node${nodeVersion}/common.gypi 2>/dev/null || ls /usr/include/node/common.gypi 2>/dev/null`, { stdio: 'ignore' });
    } catch (e) {
      missing.push(`nodejs${nodeVersion}-devel or nodejs-devel`);
    }
  }

  return missing;
}

console.log('Checking build requirements for node-pty...\n');

// Check Python version
if (!checkPythonVersion()) {
  console.error('⚠ Warning: Python 3.8+ is required for building node-pty');
  console.error('  Please install Python 3.8 or later:');

  const platform = os.platform();
  if (platform === 'linux') {
    const distro = getLinuxDistro();
    if (distro.includes('ubuntu') || distro.includes('debian')) {
      console.error('    sudo apt-get install python3.11 python3.11-dev');
    } else if (distro.includes('fedora') || distro.includes('rhel') || distro.includes('centos')) {
      console.error('    sudo dnf install python3.11 python3.11-devel');
    } else if (distro.includes('suse') || distro.includes('opensuse')) {
      console.error('    sudo zypper install python311 python311-devel');
    } else {
      console.error('    Install Python 3.8+ using your package manager');
    }
  } else if (platform === 'darwin') {
    console.error('    brew install python@3.11');
  } else if (platform === 'win32') {
    console.error('    Download from https://www.python.org/downloads/');
  }
  console.error('');
}

// Check build tools
const missing = checkBuildTools();
if (missing.length > 0) {
  console.error('⚠ Warning: Missing build tools:', missing.join(', '));

  const platform = os.platform();
  if (platform === 'linux') {
    const distro = getLinuxDistro();
    if (distro.includes('ubuntu') || distro.includes('debian')) {
      console.error('    sudo apt-get install build-essential nodejs-dev');
    } else if (distro.includes('fedora') || distro.includes('rhel') || distro.includes('centos')) {
      console.error(`    sudo dnf install gcc gcc-c++ make nodejs-devel`);
    } else if (distro.includes('suse') || distro.includes('opensuse')) {
      const nodeVersion = process.version.match(/v(\d+)/)[1];
      console.error(`    sudo zypper install gcc gcc-c++ make nodejs${nodeVersion}-devel`);
    }
  }
  console.error('');
}

function getLinuxDistro() {
  try {
    const release = execSync('cat /etc/*release 2>/dev/null', { encoding: 'utf-8' }).toLowerCase();
    return release;
  } catch (e) {
    return '';
  }
}

console.log('Installation will continue with available tools...\n');