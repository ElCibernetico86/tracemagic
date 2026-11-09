/**
 * Built-in raster sample generator so users can test TraceMagic with 1 click
 * (Logo, Emblem, Line Sketch, Pixel Art) just like Vectorizer.AI's sample tray.
 */

export interface SamplePreset {
  id: string;
  label: string;
  subtitle: string;
  render: () => Promise<File>;
}

function canvasToFile(canvas: HTMLCanvasElement, filename: string): Promise<File> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) return reject(new Error('Could not generate sample image'));
      resolve(new File([blob], filename, { type: 'image/png' }));
    }, 'image/png');
  });
}

export const SAMPLE_IMAGES: SamplePreset[] = [
  {
    id: 'geometric-logo',
    label: 'Brand Logo',
    subtitle: '4 colors · curves + sharp corners',
    render: async () => {
      const c = document.createElement('canvas');
      c.width = 640;
      c.height = 480;
      const ctx = c.getContext('2d')!;

      // Rounded navy badge background
      ctx.fillStyle = '#0F172A';
      ctx.beginPath();
      ctx.roundRect(60, 40, 520, 400, 48);
      ctx.fill();

      // Vibrant lime outer ring
      ctx.fillStyle = '#C1FF00';
      ctx.beginPath();
      ctx.arc(320, 210, 118, 0, Math.PI * 2);
      ctx.fill();

      // Inner navy cutout circle
      ctx.fillStyle = '#0F172A';
      ctx.beginPath();
      ctx.arc(320, 210, 76, 0, Math.PI * 2);
      ctx.fill();

      // Coral lightning bolt / geometric prism across the ring
      ctx.fillStyle = '#FF4D4D';
      ctx.beginPath();
      ctx.moveTo(345, 95);
      ctx.lineTo(255, 220);
      ctx.lineTo(318, 220);
      ctx.lineTo(295, 325);
      ctx.lineTo(385, 200);
      ctx.lineTo(322, 200);
      ctx.closePath();
      ctx.fill();

      // Crisp white geometric wordmark bars at bottom
      ctx.fillStyle = '#F8FAFC';
      ctx.fillRect(170, 366, 90, 22);
      ctx.fillRect(275, 366, 90, 22);
      ctx.fillRect(380, 366, 90, 22);

      return canvasToFile(c, 'sample-brand-logo.png');
    },
  },
  {
    id: 'mascot-badge',
    label: 'Retro Badge',
    subtitle: '5 colors · concentric shapes',
    render: async () => {
      const c = document.createElement('canvas');
      c.width = 600;
      c.height = 600;
      const ctx = c.getContext('2d')!;

      // Shield / hexagon outer
      ctx.fillStyle = '#1E1B4B';
      ctx.beginPath();
      const cx = 300, cy = 300, R = 240;
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 3) * i - Math.PI / 6;
        const x = cx + R * Math.cos(a);
        const y = cy + R * Math.sin(a);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fill();

      // Warm gold inner sun
      ctx.fillStyle = '#F59E0B';
      ctx.beginPath();
      ctx.arc(300, 275, 145, 0, Math.PI * 2);
      ctx.fill();

      // Teal mountain peaks
      ctx.fillStyle = '#14B8A6';
      ctx.beginPath();
      ctx.moveTo(130, 380);
      ctx.lineTo(245, 210);
      ctx.lineTo(325, 315);
      ctx.lineTo(385, 235);
      ctx.lineTo(470, 380);
      ctx.closePath();
      ctx.fill();

      // Cream snow cap & star
      ctx.fillStyle = '#FEF3C7';
      ctx.beginPath();
      ctx.moveTo(245, 210);
      ctx.lineTo(212, 258);
      ctx.lineTo(245, 246);
      ctx.lineTo(278, 258);
      ctx.closePath();
      ctx.fill();

      // Crimson ribbon banner
      ctx.fillStyle = '#E11D48';
      ctx.fillRect(140, 375, 320, 54);

      return canvasToFile(c, 'sample-retro-badge.png');
    },
  },
  {
    id: 'cad-sketch',
    label: 'Line Art / CAD',
    subtitle: 'B&W · technical drawing',
    render: async () => {
      const c = document.createElement('canvas');
      c.width = 600;
      c.height = 600;
      const ctx = c.getContext('2d')!;

      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, 600, 600);

      ctx.strokeStyle = '#000000';
      ctx.fillStyle = '#000000';
      ctx.lineWidth = 18;

      // Gear teeth + ring
      const cx = 300, cy = 300;
      for (let i = 0; i < 8; i++) {
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate((Math.PI / 4) * i);
        ctx.fillRect(-28, -225, 56, 60);
        ctx.restore();
      }

      ctx.beginPath();
      ctx.arc(cx, cy, 175, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.arc(cx, cy, 95, 0, Math.PI * 2);
      ctx.fill();

      // Keyway slot
      ctx.fillRect(276, 175, 48, 45);

      return canvasToFile(c, 'sample-cad-gear.png');
    },
  },
];
