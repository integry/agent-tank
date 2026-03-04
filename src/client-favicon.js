// Client-side JavaScript for favicon generation
// This module exports a string containing the favicon generation code

const faviconScript = `
    // Generate vertical tank favicon using Canvas API
    // Tank drains/fills based on usage - available space shown as liquid level
    function generateProgressFavicon(percent, color) {
      const canvas = document.createElement('canvas');
      const size = 64; // Favicon size
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');

      // Clear canvas
      ctx.clearRect(0, 0, size, size);

      // Tank dimensions - U-shaped vertical tank
      const tankLeft = 12;
      const tankRight = size - 12;
      const tankTop = 8;
      const tankBottom = size - 4;
      const tankWidth = tankRight - tankLeft;
      const tankHeight = tankBottom - tankTop;
      const cornerRadius = 8;

      // Determine fill color based on percentage thresholds
      // 0-50% green (plenty left), 51-80% yellow (caution), 81-100% red (critical)
      let fillColor;
      if (percent <= 50) {
        fillColor = '#48bb78'; // Green - plenty available
      } else if (percent <= 80) {
        fillColor = '#ecc94b'; // Yellow - caution
      } else {
        fillColor = '#e53e3e'; // Red - critical
      }

      // Calculate liquid level (inverted - 0% usage = full tank, 100% usage = empty tank)
      const availablePercent = 100 - percent;
      const liquidHeight = (availablePercent / 100) * (tankHeight - cornerRadius);
      const liquidTop = tankBottom - cornerRadius - liquidHeight;

      // Draw tank background (empty space)
      ctx.fillStyle = 'rgba(100, 100, 100, 0.3)';
      ctx.beginPath();
      ctx.moveTo(tankLeft, tankTop);
      ctx.lineTo(tankRight, tankTop);
      ctx.lineTo(tankRight, tankBottom - cornerRadius);
      ctx.quadraticCurveTo(tankRight, tankBottom, tankRight - cornerRadius, tankBottom);
      ctx.lineTo(tankLeft + cornerRadius, tankBottom);
      ctx.quadraticCurveTo(tankLeft, tankBottom, tankLeft, tankBottom - cornerRadius);
      ctx.lineTo(tankLeft, tankTop);
      ctx.closePath();
      ctx.fill();

      // Draw liquid fill
      if (availablePercent > 0) {
        ctx.fillStyle = fillColor;
        ctx.beginPath();

        // Start from bottom-left corner
        if (liquidTop >= tankBottom - cornerRadius) {
          // Liquid is below the curved part
          ctx.moveTo(tankLeft, liquidTop);
          ctx.lineTo(tankRight, liquidTop);
          ctx.lineTo(tankRight, tankBottom - cornerRadius);
          ctx.quadraticCurveTo(tankRight, tankBottom, tankRight - cornerRadius, tankBottom);
          ctx.lineTo(tankLeft + cornerRadius, tankBottom);
          ctx.quadraticCurveTo(tankLeft, tankBottom, tankLeft, tankBottom - cornerRadius);
        } else {
          // Liquid extends into the curved area or fills more
          ctx.moveTo(tankLeft, liquidTop);
          ctx.lineTo(tankRight, liquidTop);
          ctx.lineTo(tankRight, tankBottom - cornerRadius);
          ctx.quadraticCurveTo(tankRight, tankBottom, tankRight - cornerRadius, tankBottom);
          ctx.lineTo(tankLeft + cornerRadius, tankBottom);
          ctx.quadraticCurveTo(tankLeft, tankBottom, tankLeft, tankBottom - cornerRadius);
        }
        ctx.closePath();
        ctx.fill();

        // Add liquid shine effect
        const gradient = ctx.createLinearGradient(tankLeft, 0, tankRight, 0);
        gradient.addColorStop(0, 'rgba(255, 255, 255, 0.2)');
        gradient.addColorStop(0.3, 'rgba(255, 255, 255, 0.1)');
        gradient.addColorStop(1, 'rgba(0, 0, 0, 0.1)');
        ctx.fillStyle = gradient;
        ctx.fill();
      }

      // Draw tank outline
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(tankLeft, tankTop);
      ctx.lineTo(tankRight, tankTop);
      ctx.lineTo(tankRight, tankBottom - cornerRadius);
      ctx.quadraticCurveTo(tankRight, tankBottom, tankRight - cornerRadius, tankBottom);
      ctx.lineTo(tankLeft + cornerRadius, tankBottom);
      ctx.quadraticCurveTo(tankLeft, tankBottom, tankLeft, tankBottom - cornerRadius);
      ctx.lineTo(tankLeft, tankTop);
      ctx.stroke();

      // Draw measurement tick marks
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
      ctx.lineWidth = 1;
      for (let i = 1; i <= 4; i++) {
        const tickY = tankTop + (tankHeight - cornerRadius) * (i / 5);
        ctx.beginPath();
        ctx.moveTo(tankLeft + 2, tickY);
        ctx.lineTo(tankLeft + 8, tickY);
        ctx.stroke();
      }

      // Convert to favicon
      const faviconUrl = canvas.toDataURL('image/png');

      // Update or create favicon link
      let faviconLink = document.querySelector('link[rel="icon"]');
      if (!faviconLink) {
        faviconLink = document.createElement('link');
        faviconLink.rel = 'icon';
        document.head.appendChild(faviconLink);
      }
      faviconLink.href = faviconUrl;
    }

    // Generate default idle tank favicon when monitoring is not active
    function generateDefaultFavicon() {
      const canvas = document.createElement('canvas');
      const size = 64;
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');

      // Clear canvas
      ctx.clearRect(0, 0, size, size);

      // Tank dimensions - same as progress favicon
      const tankLeft = 12;
      const tankRight = size - 12;
      const tankTop = 8;
      const tankBottom = size - 4;
      const tankWidth = tankRight - tankLeft;
      const tankHeight = tankBottom - tankTop;
      const cornerRadius = 8;

      // Draw empty tank background (no liquid)
      ctx.fillStyle = 'rgba(100, 100, 100, 0.25)';
      ctx.beginPath();
      ctx.moveTo(tankLeft, tankTop);
      ctx.lineTo(tankRight, tankTop);
      ctx.lineTo(tankRight, tankBottom - cornerRadius);
      ctx.quadraticCurveTo(tankRight, tankBottom, tankRight - cornerRadius, tankBottom);
      ctx.lineTo(tankLeft + cornerRadius, tankBottom);
      ctx.quadraticCurveTo(tankLeft, tankBottom, tankLeft, tankBottom - cornerRadius);
      ctx.lineTo(tankLeft, tankTop);
      ctx.closePath();
      ctx.fill();

      // Draw tank outline (subdued color for idle state)
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(tankLeft, tankTop);
      ctx.lineTo(tankRight, tankTop);
      ctx.lineTo(tankRight, tankBottom - cornerRadius);
      ctx.quadraticCurveTo(tankRight, tankBottom, tankRight - cornerRadius, tankBottom);
      ctx.lineTo(tankLeft + cornerRadius, tankBottom);
      ctx.quadraticCurveTo(tankLeft, tankBottom, tankLeft, tankBottom - cornerRadius);
      ctx.lineTo(tankLeft, tankTop);
      ctx.stroke();

      // Draw measurement tick marks (subdued)
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
      ctx.lineWidth = 1;
      for (let i = 1; i <= 4; i++) {
        const tickY = tankTop + (tankHeight - cornerRadius) * (i / 5);
        ctx.beginPath();
        ctx.moveTo(tankLeft + 2, tickY);
        ctx.lineTo(tankLeft + 8, tickY);
        ctx.stroke();
      }

      // Convert to favicon
      const faviconUrl = canvas.toDataURL('image/png');

      // Update or create favicon link
      let faviconLink = document.querySelector('link[rel="icon"]');
      if (!faviconLink) {
        faviconLink = document.createElement('link');
        faviconLink.rel = 'icon';
        document.head.appendChild(faviconLink);
      }
      faviconLink.href = faviconUrl;
    }
`;

module.exports = { faviconScript };
