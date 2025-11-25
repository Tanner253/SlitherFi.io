'use client';

import { useEffect, useRef } from 'react';

interface SnakePreviewProps {
  width?: number;
  height?: number;
  equippedCosmetics?: {
    trail?: string;
    headItem?: string;
    nameStyle?: string;
  };
  showName?: boolean;
  playerName?: string;
}

export function SnakePreview({ 
  width = 200, 
  height = 160,
  equippedCosmetics = {},
  showName = false,
  playerName = 'Player'
}: SnakePreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set canvas to fill container
    const updateSize = () => {
      const rect = container.getBoundingClientRect();
      canvas.width = rect.width;
      canvas.height = rect.height;
    };
    updateSize();
    window.addEventListener('resize', updateSize);

    let animationTime = 0;

    const animate = () => {
      animationTime += 0.05;
      const now = Date.now();
      
      const canvasWidth = canvas.width;
      const canvasHeight = canvas.height;
      
      // Clear canvas
      ctx.clearRect(0, 0, canvasWidth, canvasHeight);

      // RESPONSIVE Snake properties
      const segmentRadius = Math.max(8, canvasWidth / 25);
      const headRadius = segmentRadius * 1.5;
      const segmentCount = 7;

      // Calculate proper centering with room for head items and text
      const topMargin = 45; // More room for tall head items (crown, hat, halo)
      const bottomMargin = showName ? 30 : 15; // More room for text
      const availableHeight = canvasHeight - topMargin - bottomMargin;
      const centerY = topMargin + (availableHeight / 2);

      // Calculate snake with segments overlapping slightly (like in-game)
      const segmentSpacing = segmentRadius * 1.6; // Segments overlap slightly
      const snakeLength = (segmentCount - 1) * segmentSpacing;
      const startX = (canvasWidth - snakeLength) / 2; // Center the snake horizontally
      
      const segments: Array<{ x: number; y: number }> = [];
      
      for (let i = 0; i < segmentCount; i++) {
        const x = startX + (i * segmentSpacing);
        const y = centerY + Math.sin(animationTime + i * 0.5) * 4; // Reduced wave amplitude
        segments.push({ x, y });
      }

      const head = segments[segmentCount - 1];
      const angle = Math.atan2(
        segments[segmentCount - 1].y - segments[segmentCount - 2].y,
        segments[segmentCount - 1].x - segments[segmentCount - 2].x
      );

      // Trail cosmetics - FIXED sizes (not scaled)
      const trailLength = Math.min(segments.length - 1, 6);
      
      if (equippedCosmetics.trail === 'trail_basic_glow') {
        for (let i = 0; i < trailLength; i++) {
          const seg = segments[i];
          const alpha = 1 - (i / trailLength);
          ctx.save();
          ctx.globalAlpha = alpha * 0.6;
          ctx.fillStyle = '#4ECDC4';
          ctx.shadowColor = '#4ECDC4';
          ctx.shadowBlur = 15;
          ctx.beginPath();
          ctx.arc(seg.x, seg.y, segmentRadius + 5, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      } else if (equippedCosmetics.trail === 'trail_rainbow') {
        const rainbowColors = ['#FF0000', '#FF7F00', '#FFFF00', '#00FF00', '#0000FF', '#4B0082', '#9400D3'];
        for (let i = 0; i < trailLength; i++) {
          const seg = segments[i];
          const alpha = 1 - (i / trailLength);
          const colorIndex = (i + Math.floor(now / 100)) % rainbowColors.length;
          ctx.save();
          ctx.globalAlpha = alpha * 0.7;
          ctx.fillStyle = rainbowColors[colorIndex];
          ctx.shadowColor = rainbowColors[colorIndex];
          ctx.shadowBlur = 12;
          ctx.beginPath();
          ctx.arc(seg.x, seg.y, segmentRadius + 4, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      } else if (equippedCosmetics.trail === 'trail_fire') {
        const fireColors = ['#FF4500', '#FF6347', '#FFD700', '#FF8C00'];
        for (let i = 0; i < trailLength; i++) {
          const seg = segments[i];
          const alpha = 1 - (i / trailLength);
          const colorIndex = Math.floor(Math.random() * fireColors.length);
          const flicker = 0.7 + Math.random() * 0.3;
          ctx.save();
          ctx.globalAlpha = alpha * 0.8 * flicker;
          ctx.fillStyle = fireColors[colorIndex];
          ctx.shadowColor = '#FF4500';
          ctx.shadowBlur = 18;
          ctx.beginPath();
          ctx.arc(seg.x, seg.y, segmentRadius + 4, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      } else if (equippedCosmetics.trail === 'trail_lightning') {
        const lightningColors = ['#00F0FF', '#FFFFFF', '#4169E1'];
        for (let i = 0; i < trailLength; i++) {
          const seg = segments[i];
          const alpha = 1 - (i / trailLength);
          const colorIndex = Math.floor(Math.random() * lightningColors.length);
          ctx.save();
          ctx.globalAlpha = alpha * 0.9;
          ctx.fillStyle = lightningColors[colorIndex];
          ctx.shadowColor = '#00F0FF';
          ctx.shadowBlur = 20;
          ctx.beginPath();
          ctx.arc(seg.x, seg.y, segmentRadius + 3, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      } else if (equippedCosmetics.trail === 'trail_shadow') {
        const shadowColors = ['#2E003E', '#3D0066', '#1A001F'];
        for (let i = 0; i < trailLength; i++) {
          const seg = segments[i];
          const alpha = 1 - (i / trailLength);
          const colorIndex = i % shadowColors.length;
          ctx.save();
          ctx.globalAlpha = alpha * 0.5;
          ctx.fillStyle = shadowColors[colorIndex];
          ctx.shadowColor = '#2E003E';
          ctx.shadowBlur = 12;
          ctx.beginPath();
          ctx.arc(seg.x, seg.y, segmentRadius + 6, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      }

      // Draw candy cane body segments
      for (let i = 0; i < segments.length - 1; i++) {
        const seg = segments[i];
        const isRed = i % 2 === 0;
        ctx.fillStyle = isRed ? '#DC143C' : '#FFFFFF';
        ctx.beginPath();
        ctx.arc(seg.x, seg.y, segmentRadius, 0, Math.PI * 2);
        ctx.fill();
        
        ctx.strokeStyle = 'rgba(0,0,0,0.3)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      // Draw candy cane head
      ctx.fillStyle = '#DC143C';
      ctx.beginPath();
      ctx.arc(head.x, head.y, headRadius, 0, Math.PI * 2);
      ctx.fill();
      
      ctx.strokeStyle = 'rgba(0,0,0,0.3)';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Calculate eye positions FIRST (needed for sunglasses) - SCALED to head size
      const eyeOffset = headRadius * 0.47;
      const eyeRadius = headRadius * 0.27;
      
      const leftEyeX = head.x + Math.cos(angle - Math.PI / 6) * eyeOffset;
      const leftEyeY = head.y + Math.sin(angle - Math.PI / 6) * eyeOffset;
      const rightEyeX = head.x + Math.cos(angle + Math.PI / 6) * eyeOffset;
      const rightEyeY = head.y + Math.sin(angle + Math.PI / 6) * eyeOffset;

      // Draw eyes ONLY if not wearing sunglasses
      if (equippedCosmetics.headItem !== 'head_sunglasses') {
        // Left eye
        ctx.fillStyle = 'white';
        ctx.beginPath();
        ctx.arc(leftEyeX, leftEyeY, eyeRadius, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'black';
        ctx.beginPath();
        ctx.arc(leftEyeX, leftEyeY, eyeRadius * 0.5, 0, Math.PI * 2);
        ctx.fill();
        
        // Right eye
        ctx.fillStyle = 'white';
        ctx.beginPath();
        ctx.arc(rightEyeX, rightEyeY, eyeRadius, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'black';
        ctx.beginPath();
        ctx.arc(rightEyeX, rightEyeY, eyeRadius * 0.5, 0, Math.PI * 2);
        ctx.fill();
      }

      // IMPROVED head item cosmetics - SCALED to snake size
      if (equippedCosmetics.headItem === 'head_party_hat') {
        ctx.save();
        const hatHeight = headRadius * 1.2;
        const hatWidth = headRadius * 0.4;
        const gradient = ctx.createLinearGradient(head.x, head.y - headRadius - hatHeight, head.x, head.y - headRadius);
        gradient.addColorStop(0, '#FF10F0');
        gradient.addColorStop(0.5, '#00F0FF');
        gradient.addColorStop(1, '#FFFF00');
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.moveTo(head.x, head.y - headRadius - hatHeight);
        ctx.lineTo(head.x - hatWidth, head.y - headRadius);
        ctx.lineTo(head.x + hatWidth, head.y - headRadius);
        ctx.closePath();
        ctx.fill();
        // Pom-pom
        ctx.fillStyle = '#FFFFFF';
        ctx.beginPath();
        ctx.arc(head.x, head.y - headRadius - hatHeight, headRadius * 0.15, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      } else if (equippedCosmetics.headItem === 'head_halo') {
        ctx.save();
        // Outer glow
        ctx.globalAlpha = 0.4;
        ctx.strokeStyle = '#FFD700';
        ctx.lineWidth = 4;
        ctx.shadowColor = '#FFD700';
        ctx.shadowBlur = 15;
        ctx.beginPath();
        ctx.arc(head.x, head.y - headRadius - 8, 10, 0, Math.PI * 2);
        ctx.stroke();
        // Inner bright ring
        ctx.globalAlpha = 1;
        ctx.strokeStyle = '#FFEB3B';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(head.x, head.y - headRadius - 8, 10, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      } else if (equippedCosmetics.headItem === 'head_sunglasses') {
        // Cool sunglasses - positioned exactly over eyes, SCALED
        ctx.save();
        const lensWidth = eyeRadius * 1.3;
        const lensHeight = eyeRadius * 1.0;
        ctx.fillStyle = '#1a1a1a';
        // Left lens - over left eye
        ctx.beginPath();
        ctx.ellipse(leftEyeX, leftEyeY, lensWidth, lensHeight, 0, 0, Math.PI * 2);
        ctx.fill();
        // Right lens - over right eye
        ctx.beginPath();
        ctx.ellipse(rightEyeX, rightEyeY, lensWidth, lensHeight, 0, 0, Math.PI * 2);
        ctx.fill();
        // Bridge
        ctx.strokeStyle = '#1a1a1a';
        ctx.lineWidth = eyeRadius * 0.5;
        ctx.beginPath();
        ctx.moveTo(leftEyeX + lensWidth * 0.7, leftEyeY);
        ctx.lineTo(rightEyeX - lensWidth * 0.7, rightEyeY);
        ctx.stroke();
        // Frame outline (gold/brown)
        ctx.strokeStyle = '#8B4513';
        ctx.lineWidth = eyeRadius * 0.25;
        ctx.beginPath();
        ctx.ellipse(leftEyeX, leftEyeY, lensWidth, lensHeight, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.ellipse(rightEyeX, rightEyeY, lensWidth, lensHeight, 0, 0, Math.PI * 2);
        ctx.stroke();
        // Add shine
        ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.beginPath();
        ctx.ellipse(leftEyeX - lensWidth * 0.3, leftEyeY - lensHeight * 0.4, eyeRadius * 0.35, eyeRadius * 0.25, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(rightEyeX - lensWidth * 0.3, rightEyeY - lensHeight * 0.4, eyeRadius * 0.35, eyeRadius * 0.25, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      } else if (equippedCosmetics.headItem === 'head_devil_horns') {
        ctx.save();
        const hornSpacing = headRadius * 0.6;
        const hornHeight = headRadius * 0.8;
        ctx.fillStyle = '#DC143C';
        ctx.shadowColor = '#8B0000';
        ctx.shadowBlur = 6;
        // Left horn
        ctx.beginPath();
        ctx.moveTo(head.x - hornSpacing, head.y - headRadius - headRadius * 0.3);
        ctx.quadraticCurveTo(head.x - hornSpacing * 1.2, head.y - headRadius - headRadius * 0.6, head.x - hornSpacing * 0.9, head.y - headRadius - hornHeight);
        ctx.lineTo(head.x - hornSpacing * 0.7, head.y - headRadius - headRadius * 0.3);
        ctx.closePath();
        ctx.fill();
        // Right horn
        ctx.beginPath();
        ctx.moveTo(head.x + hornSpacing, head.y - headRadius - headRadius * 0.3);
        ctx.quadraticCurveTo(head.x + hornSpacing * 1.2, head.y - headRadius - headRadius * 0.6, head.x + hornSpacing * 0.9, head.y - headRadius - hornHeight);
        ctx.lineTo(head.x + hornSpacing * 0.7, head.y - headRadius - headRadius * 0.3);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      } else if (equippedCosmetics.headItem === 'head_crown') {
        // Royal Crown - IMPROVED ornate design - SCALED
        ctx.save();
        const crownBase = head.y - headRadius - headRadius * 0.53;
        const crownTop = head.y - headRadius - headRadius * 1.47;
        const crownWidth = headRadius * 0.8;
        
        // Draw crown base (band) with gradient
        const baseGradient = ctx.createLinearGradient(head.x - crownWidth, crownBase, head.x + crownWidth, crownBase);
        baseGradient.addColorStop(0, '#B8860B');
        baseGradient.addColorStop(0.5, '#FFD700');
        baseGradient.addColorStop(1, '#B8860B');
        ctx.fillStyle = baseGradient;
        ctx.fillRect(head.x - crownWidth, crownBase, crownWidth * 2, headRadius * 0.27);
        
        // Draw crown points (3 elegant points)
        ctx.fillStyle = '#FFD700';
        ctx.strokeStyle = '#DAA520';
        ctx.lineWidth = headRadius * 0.1;
        
        // Left point
        ctx.beginPath();
        ctx.moveTo(head.x - crownWidth * 0.83, crownBase - headRadius * 0.07);
        ctx.lineTo(head.x - crownWidth * 0.67, crownTop + headRadius * 0.4);
        ctx.lineTo(head.x - crownWidth * 0.5, crownBase - headRadius * 0.07);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        
        // Center point (tallest)
        ctx.beginPath();
        ctx.moveTo(head.x - headRadius * 0.2, crownBase - headRadius * 0.07);
        ctx.lineTo(head.x, crownTop);
        ctx.lineTo(head.x + headRadius * 0.2, crownBase - headRadius * 0.07);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        
        // Right point
        ctx.beginPath();
        ctx.moveTo(head.x + crownWidth * 0.5, crownBase - headRadius * 0.07);
        ctx.lineTo(head.x + crownWidth * 0.67, crownTop + headRadius * 0.4);
        ctx.lineTo(head.x + crownWidth * 0.83, crownBase - headRadius * 0.07);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        
        // Add jewels on each point
        const jewelSize = headRadius * 0.13;
        ctx.fillStyle = '#DC143C';
        ctx.shadowColor = '#DC143C';
        ctx.shadowBlur = 3;
        // Left jewel
        ctx.beginPath();
        ctx.arc(head.x - crownWidth * 0.67, crownTop + headRadius * 0.33, jewelSize, 0, Math.PI * 2);
        ctx.fill();
        // Center jewel (larger)
        ctx.beginPath();
        ctx.arc(head.x, crownTop - headRadius * 0.07, jewelSize * 1.2, 0, Math.PI * 2);
        ctx.fill();
        // Right jewel
        ctx.beginPath();
        ctx.arc(head.x + crownWidth * 0.67, crownTop + headRadius * 0.33, jewelSize, 0, Math.PI * 2);
        ctx.fill();
        
        // Add gold accents on base
        ctx.fillStyle = '#FFD700';
        ctx.shadowBlur = 0;
        for (let i = -2; i <= 2; i++) {
          ctx.beginPath();
          ctx.arc(head.x + i * crownWidth * 0.4, crownBase + headRadius * 0.13, headRadius * 0.07, 0, Math.PI * 2);
          ctx.fill();
        }
        
        ctx.restore();
      }

      // IMPROVED name styles
      if (showName) {
        ctx.save();
        ctx.textAlign = 'center';
        ctx.font = 'bold 11px Arial';
        
        if (equippedCosmetics.nameStyle === 'name_rainbow') {
          // ANIMATED Rainbow
          const offset = (now / 50) % 100;
          const gradient = ctx.createLinearGradient(head.x - 40 + offset, 0, head.x + 40 + offset, 0);
          gradient.addColorStop(0, '#FF0000');
          gradient.addColorStop(0.16, '#FF7F00');
          gradient.addColorStop(0.33, '#FFFF00');
          gradient.addColorStop(0.5, '#00FF00');
          gradient.addColorStop(0.66, '#0000FF');
          gradient.addColorStop(0.83, '#4B0082');
          gradient.addColorStop(1, '#9400D3');
          ctx.fillStyle = gradient;
          ctx.shadowColor = '#000000';
          ctx.shadowBlur = 3;
        } else if (equippedCosmetics.nameStyle === 'name_gold_glow') {
          ctx.fillStyle = '#FFD700';
          ctx.shadowColor = '#FFD700';
          ctx.shadowBlur = 12;
          ctx.strokeStyle = '#FFA500';
          ctx.lineWidth = 0.8;
          ctx.strokeText(playerName, head.x, head.y + headRadius + 18);
        } else if (equippedCosmetics.nameStyle === 'name_neon_pulse') {
          // RGB Cycling neon pulse
          const pulse = 0.85 + 0.3 * Math.sin(now / 300);
          const colorShift = (now / 1000) % 3;
          let r = 0, g = 0, b = 255;
          if (colorShift < 1) {
            r = Math.floor(255 * (1 - colorShift));
            g = Math.floor(255 * colorShift);
            b = 0;
          } else if (colorShift < 2) {
            r = 0;
            g = Math.floor(255 * (2 - colorShift));
            b = Math.floor(255 * (colorShift - 1));
          } else {
            r = Math.floor(255 * (colorShift - 2));
            g = 0;
            b = Math.floor(255 * (3 - colorShift));
          }
          const rgbColor = `rgb(${r}, ${g}, ${b})`;
          ctx.fillStyle = rgbColor;
          ctx.shadowColor = rgbColor;
          ctx.shadowBlur = 18 * pulse;
          ctx.globalAlpha = pulse;
        } else if (equippedCosmetics.nameStyle === 'name_fire') {
          const flicker = 0.85 + Math.random() * 0.15;
          const gradient = ctx.createLinearGradient(head.x, head.y + headRadius + 10, head.x, head.y + headRadius + 25);
          gradient.addColorStop(0, '#FFD700');
          gradient.addColorStop(0.5, '#FF4500');
          gradient.addColorStop(1, '#FF0000');
          ctx.fillStyle = gradient;
          ctx.shadowColor = '#FF4500';
          ctx.shadowBlur = 10;
          ctx.globalAlpha = flicker;
        } else if (equippedCosmetics.nameStyle === 'name_ice') {
          ctx.fillStyle = '#87CEEB';
          ctx.shadowColor = '#E0FFFF';
          ctx.shadowBlur = 8;
          ctx.strokeStyle = '#4682B4';
          ctx.lineWidth = 1.5;
          ctx.strokeText(playerName, head.x, head.y + headRadius + 18);
        } else {
          ctx.fillStyle = '#ffffff';
          ctx.shadowColor = '#000';
          ctx.shadowBlur = 2;
        }
        
        // Position text with proper spacing
        const textY = head.y + headRadius + (canvasHeight > 100 ? 22 : 18);
        ctx.fillText(playerName, head.x, textY);
        ctx.restore();
      }

      requestAnimationFrame(animate);
    };

    const animationId = requestAnimationFrame(animate);

    return () => {
      window.removeEventListener('resize', updateSize);
      cancelAnimationFrame(animationId);
    };
  }, [equippedCosmetics, showName, playerName]);

  return (
    <div ref={containerRef} className="w-full h-full rounded-lg">
      <canvas
        ref={canvasRef}
        className="rounded-lg w-full h-full"
      />
    </div>
  );
}
