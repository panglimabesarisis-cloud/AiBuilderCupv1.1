import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAccessControl, hasValidAuthSession } from '../../context/AccessControlContext';

export const LoginPage: React.FC = () => {
  const { isAuthenticated, loginWithCredentials } = useAccessControl();
  const navigate = useNavigate();
  const location = useLocation();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ text: string; type: 'info' | 'error' | 'ok' } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const getRedirectDestination = () => {
    const fromPath = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname;
    if (fromPath && fromPath !== '/login' && fromPath !== '/') {
      return fromPath;
    }
    return '/dashboard';
  };

  useEffect(() => {
    if (isAuthenticated && hasValidAuthSession()) {
      navigate(getRedirectDestination(), { replace: true });
    }
  }, [isAuthenticated, navigate]);

  const handleFillDemo = () => {
    setEmail('panglimabesarisis@gmail.com');
    setPassword('Demo123');
    setStatusMessage({
      text: 'Kredensial Owner Utama terisi (panglimabesarisis@gmail.com | Pass: Demo123 atau PIN: 123456). Klik Sign In untuk masuk.',
      type: 'info',
    });
  };

  const handleQuickDemoLogin = async (roleType: 'owner' | 'admin' | 'kasir') => {
    const targetEmail =
      roleType === 'owner'
        ? 'panglimabesarisis@gmail.com'
        : roleType === 'admin'
        ? 'demo@mayamandiri.com'
        : 'kasir@mayamandiri.com';
    const targetPass = 'Demo123';
    setEmail(targetEmail);
    setPassword(targetPass);
    setIsSubmitting(true);
    setStatusMessage(null);
    try {
      const result = await loginWithCredentials(targetEmail, targetPass);
      if (result.ok) {
        setStatusMessage({ text: result.message, type: 'ok' });
        navigate(getRedirectDestination(), { replace: true });
      } else {
        setStatusMessage({ text: result.message, type: 'error' });
      }
    } catch {
      setStatusMessage({
        text: 'Terjadi kesalahan saat masuk ke akun. Silakan coba lagi.',
        type: 'error',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanEmailInput = email.trim();
    const cleanPassInput = password.trim();
    if (!cleanEmailInput || !cleanPassInput) {
      setStatusMessage({
        text: 'Silakan masukkan Email/Username dan Password/PIN Anda terlebih dahulu.',
        type: 'error',
      });
      return;
    }

    setIsSubmitting(true);
    setStatusMessage(null);
    try {
      const result = await loginWithCredentials(cleanEmailInput, cleanPassInput);
      if (result.ok) {
        setStatusMessage({ text: result.message, type: 'ok' });
        navigate(getRedirectDestination(), { replace: true });
      } else {
        setStatusMessage({
          text:
            result.message ||
            'Email/Username atau Password/PIN salah. Silakan periksa kembali kredensial Anda.',
          type: 'error',
        });
      }
    } catch {
      setStatusMessage({
        text: 'Terjadi kesalahan saat memverifikasi akun. Silakan coba lagi.',
        type: 'error',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="rc-master-login-root fixed inset-0 z-50 w-full h-[100dvh] overflow-y-auto overflow-x-hidden select-none">
      <style>{`
        .rc-master-login-root {
          --gold-1: #ffd875;
          --gold-2: #f4be42;
          --gold-3: #d8941c;
          --gold-line: #dca62c;
          --bg: #050403;
          --text: #ffffff;
          --muted: #b3aea3;
          --placeholder: #787368;
          font-family: "Inter", "Plus Jakarta Sans", system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
          background: var(--bg);
          color: var(--text);
          -webkit-font-smoothing: antialiased;
          text-rendering: optimizeLegibility;
        }

        /* ================= LATAR GELOMBANG EMAS ================= */
        .rc-master-login-root .bg {
          position: fixed;
          inset: 0;
          z-index: 0;
          overflow: hidden;
          pointer-events: none;
          background:
            radial-gradient(ellipse at 50% 42%, rgba(255, 190, 60, 0.05), transparent 60%),
            #050403;
        }

        .rc-master-login-root .bg > svg {
          position: absolute;
          display: block;
          overflow: visible;
        }
        .rc-master-login-root .bg-top {
          top: 0;
          left: 0;
          width: 100%;
          height: 44vh;
        }
        .rc-master-login-root .bg-bottom {
          bottom: 0;
          right: 0;
          width: 100%;
          height: 60vh;
        }
        @media (min-aspect-ratio: 1/1) {
          .rc-master-login-root .bg-top    { height: 52vh; }
          .rc-master-login-root .bg-bottom { height: 66vh; }
        }

        .rc-master-login-root .orb {
          position: absolute;
          border-radius: 50%;
          pointer-events: none;
        }
        .rc-master-login-root .orb-tl {
          left: -18vmax;
          top: -14vmax;
          width: 48vmax;
          height: 48vmax;
          background: radial-gradient(circle, rgba(255, 200, 80, 0.34) 0%, rgba(255, 170, 30, 0.10) 42%, transparent 68%);
        }
        .rc-master-login-root .orb-br {
          right: -18vmax;
          bottom: -16vmax;
          width: 52vmax;
          height: 52vmax;
          background: radial-gradient(circle, rgba(255, 185, 45, 0.28) 0%, rgba(255, 150, 20, 0.08) 45%, transparent 68%);
        }

        .rc-master-login-root .wave-float {
          animation: rcMasterWaveDrift 9s ease-in-out infinite alternate;
        }
        .rc-master-login-root .wave-float.slow {
          animation-duration: 13s;
          animation-direction: alternate-reverse;
        }
        @keyframes rcMasterWaveDrift {
          0%   { transform: translate3d(0, 0, 0); }
          100% { transform: translate3d(0, -8px, 0); }
        }

        .rc-master-login-root .spark {
          animation: rcMasterTwinkle 3.2s ease-in-out infinite;
        }
        .rc-master-login-root .spark:nth-child(2n) { animation-delay: -1.1s; animation-duration: 4.1s; }
        .rc-master-login-root .spark:nth-child(3n) { animation-delay: -2.3s; animation-duration: 2.7s; }
        .rc-master-login-root .spark:nth-child(4n) { animation-delay: -0.6s; animation-duration: 3.7s; }
        @keyframes rcMasterTwinkle {
          0%, 100% { opacity: 0.25; }
          50%      { opacity: 1; }
        }

        .rc-master-login-root .dust-layer {
          position: absolute;
          inset: 0;
          overflow: hidden;
        }
        .rc-master-login-root .dust {
          position: absolute;
          bottom: -12px;
          border-radius: 50%;
          background: radial-gradient(circle, #fff3c4 0%, #ffc84a 60%, rgba(255, 190, 60, 0) 100%);
          box-shadow: 0 0 8px rgba(255, 205, 95, 0.9);
          opacity: 0;
          animation: rcMasterRise linear infinite;
        }
        @keyframes rcMasterRise {
          0%   { transform: translate3d(0, 0, 0) scale(0.6); opacity: 0; }
          15%  { opacity: 0.85; }
          85%  { opacity: 0.65; }
          100% { transform: translate3d(var(--sx, 20px), -105vh, 0) scale(1.1); opacity: 0; }
        }

        /* ================= TATA LETAK UTAMA ================= */
        .rc-master-login-root .page {
          position: relative;
          z-index: 2;
          min-height: 100dvh;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: clamp(20px, 4vh, 48px) clamp(16px, 4vw, 36px);
        }

        .rc-master-login-root .wrap {
          width: 100%;
          max-width: 440px;
          display: flex;
          flex-direction: column;
          align-items: center;
        }

        /* ================= HEADER LOGO ================= */
        .rc-master-login-root .brand {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: clamp(12px, 2.6vw, 18px);
          margin-bottom: clamp(18px, 3vh, 28px);
          user-select: none;
          max-width: 100%;
        }

        .rc-master-login-root .brand-mark {
          width: clamp(56px, 13vw, 72px);
          height: auto;
          aspect-ratio: 100 / 110;
          flex-shrink: 0;
          filter:
            drop-shadow(0 6px 14px rgba(0, 0, 0, 0.7))
            drop-shadow(0 0 14px rgba(255, 195, 65, 0.25));
        }

        .rc-master-login-root .brand-divider {
          width: 1.5px;
          height: clamp(44px, 10vw, 56px);
          background: linear-gradient(180deg,
            rgba(255, 215, 110, 0.15),
            rgba(255, 215, 110, 0.75) 50%,
            rgba(255, 215, 110, 0.15));
          border-radius: 2px;
          flex-shrink: 0;
        }

        .rc-master-login-root .brand-text {
          display: flex;
          flex-direction: column;
          justify-content: center;
          line-height: 1;
          min-width: 0;
        }

        .rc-master-login-root .brand-name {
          font-weight: 800;
          font-size: clamp(32px, 8vw, 44px);
          letter-spacing: -0.03em;
          color: #ffffff;
          text-shadow: 0 2px 14px rgba(0, 0, 0, 0.6);
          white-space: nowrap;
        }

        .rc-master-login-root .brand-name .cart {
          background: linear-gradient(180deg, #fff2be 0%, #ffd05b 45%, #e1991c 100%);
          -webkit-background-clip: text;
          background-clip: text;
          color: transparent;
          margin-left: 4px;
          filter: drop-shadow(0 0 12px rgba(255, 190, 55, 0.28));
        }

        .rc-master-login-root .brand-sub {
          margin-top: 6px;
          font-size: clamp(13px, 3.2vw, 17px);
          font-weight: 500;
          color: #e9e4d8;
          letter-spacing: 0.02em;
          white-space: nowrap;
        }

        /* ================= KARTU LOGIN ================= */
        .rc-master-login-root .card {
          position: relative;
          width: 100%;
          border-radius: 22px;
          padding: clamp(24px, 4.5vw, 34px) clamp(20px, 5vw, 30px) clamp(22px, 4.2vw, 30px);
          background:
            radial-gradient(120% 90% at 50% 0%, rgba(255, 200, 80, 0.08), rgba(15, 12, 8, 0.72) 55%, rgba(8, 6, 4, 0.86) 100%);
          border: 1.4px solid rgba(235, 180, 60, 0.78);
          box-shadow:
            0 20px 60px rgba(0, 0, 0, 0.8),
            0 0 28px rgba(255, 185, 45, 0.16),
            inset 0 1px 0 rgba(255, 230, 150, 0.35),
            inset 0 0 24px rgba(255, 190, 60, 0.05);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
        }

        .rc-master-login-root .card::before {
          content: "";
          position: absolute;
          top: -1.5px;
          left: 14%;
          right: 14%;
          height: 2px;
          background: linear-gradient(90deg, transparent, #ffe9a6, #ffc84a, transparent);
          filter: drop-shadow(0 0 8px #ffd26a);
          pointer-events: none;
        }

        .rc-master-login-root .title {
          text-align: center;
          font-size: clamp(22px, 5.2vw, 27px);
          font-weight: 700;
          letter-spacing: -0.01em;
          color: #ffffff;
        }

        .rc-master-login-root .sub {
          text-align: center;
          margin-top: 6px;
          margin-bottom: clamp(18px, 3vh, 24px);
          font-size: clamp(12.5px, 3vw, 13.8px);
          color: var(--muted);
        }

        .rc-master-login-root .field {
          margin-bottom: 16px;
        }

        .rc-master-login-root .field label {
          display: block;
          font-size: 13.5px;
          font-weight: 600;
          color: #f3efe6;
          margin-bottom: 8px;
          letter-spacing: 0.01em;
        }

        .rc-master-login-root .input {
          position: relative;
          display: flex;
          align-items: center;
          height: 50px;
          border-radius: 12px;
          background: rgba(8, 7, 5, 0.78);
          border: 1.3px solid var(--gold-line);
          box-shadow:
            inset 0 2px 6px rgba(0, 0, 0, 0.7),
            0 0 0 0 rgba(255, 200, 75, 0);
          transition: border-color 0.2s ease, box-shadow 0.2s ease, background 0.2s ease;
        }

        .rc-master-login-root .input:focus-within {
          border-color: #ffe28a;
          background: rgba(14, 11, 7, 0.92);
          box-shadow:
            inset 0 2px 6px rgba(0, 0, 0, 0.7),
            0 0 0 3px rgba(255, 200, 75, 0.18),
            0 0 18px rgba(255, 190, 55, 0.28);
        }

        .rc-master-login-root .input .ico {
          width: 19px;
          height: 19px;
          margin-left: 15px;
          margin-right: 11px;
          color: #e5b547;
          flex-shrink: 0;
          fill: none;
          stroke: currentColor;
          stroke-width: 1.8;
          stroke-linecap: round;
          stroke-linejoin: round;
        }

        .rc-master-login-root .input input {
          flex: 1;
          height: 100%;
          width: 100%;
          min-width: 0;
          background: transparent;
          border: 0;
          outline: none;
          color: #ffffff;
          font-size: 15px;
          padding-right: 14px;
        }

        .rc-master-login-root .input input::placeholder {
          color: var(--placeholder);
        }

        .rc-master-login-root .eye {
          background: transparent;
          border: 0;
          color: #b7ae9c;
          width: 42px;
          height: 100%;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          margin-right: 4px;
          border-radius: 8px;
          transition: color 0.18s ease;
        }
        .rc-master-login-root .eye:hover { color: var(--gold-1); }
        .rc-master-login-root .eye svg {
          width: 19px;
          height: 19px;
          fill: none;
          stroke: currentColor;
          stroke-width: 1.8;
          stroke-linecap: round;
          stroke-linejoin: round;
        }

        /* Baris DEMO USER + Forgot Password */
        .rc-master-login-root .demo-forgot-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          margin-top: -2px;
          margin-bottom: 16px;
        }

        .rc-master-login-root .demo-info {
          display: flex;
          flex-direction: column;
          line-height: 1.25;
        }
        .rc-master-login-root .demo-title {
          font-size: 11.5px;
          font-weight: 800;
          letter-spacing: 0.06em;
          color: #ffd76a;
          text-transform: uppercase;
        }
        .rc-master-login-root .demo-pin {
          font-size: 12px;
          color: #d8d2c5;
          font-weight: 500;
        }
        .rc-master-login-root .demo-pin strong {
          color: #ffe89e;
          font-weight: 700;
          letter-spacing: 0.04em;
        }

        .rc-master-login-root .forgot {
          font-size: 12.8px;
          font-weight: 500;
          color: #e9b949;
          text-decoration: none;
          background: transparent;
          border: 0;
          cursor: pointer;
          transition: color 0.18s ease, text-shadow 0.18s ease;
        }
        .rc-master-login-root .forgot:hover {
          color: #ffe38e;
          text-shadow: 0 0 10px rgba(255, 200, 75, 0.45);
        }

        /* Tombol Login as Demo */
        .rc-master-login-root .btn-demo {
          width: 100%;
          height: 46px;
          border-radius: 13px;
          margin-bottom: 12px;
          border: 1.4px solid rgba(255, 212, 102, 0.78);
          cursor: pointer;
          font-size: 14.5px;
          font-weight: 700;
          letter-spacing: 0.01em;
          color: #ffe79b;
          background: linear-gradient(180deg, rgba(255, 205, 85, 0.16) 0%, rgba(215, 148, 26, 0.08) 100%);
          box-shadow:
            0 6px 18px rgba(0, 0, 0, 0.45),
            inset 0 1px 0 rgba(255, 236, 175, 0.28);
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          transition: transform 0.15s ease, filter 0.2s ease, box-shadow 0.2s ease, background 0.2s ease;
        }
        .rc-master-login-root .btn-demo:hover {
          background: linear-gradient(180deg, rgba(255, 205, 85, 0.26) 0%, rgba(215, 148, 26, 0.15) 100%);
          box-shadow:
            0 8px 22px rgba(255, 185, 40, 0.22),
            inset 0 1px 0 rgba(255, 240, 185, 0.45);
        }
        .rc-master-login-root .btn-demo:active {
          transform: translateY(1px);
        }

        /* Tombol Sign In */
        .rc-master-login-root .btn {
          width: 100%;
          height: 52px;
          border-radius: 13px;
          border: 1px solid #ffe49c;
          cursor: pointer;
          font-size: 16.5px;
          font-weight: 700;
          letter-spacing: 0.01em;
          color: #1c1300;
          background: linear-gradient(180deg,
            #fff0b5 0%,
            #ffd25a 38%,
            #f3b229 78%,
            #d88c10 100%);
          box-shadow:
            0 10px 26px rgba(255, 185, 40, 0.35),
            0 2px 6px rgba(0, 0, 0, 0.6),
            inset 0 1px 0 #fff9dc,
            inset 0 -2px 0 rgba(140, 82, 0, 0.45);
          transition: transform 0.15s ease, filter 0.2s ease, box-shadow 0.2s ease;
        }
        .rc-master-login-root .btn:hover {
          filter: brightness(1.05);
          box-shadow:
            0 12px 32px rgba(255, 195, 55, 0.5),
            0 2px 6px rgba(0, 0, 0, 0.6),
            inset 0 1px 0 #fffbe6,
            inset 0 -2px 0 rgba(140, 82, 0, 0.45);
        }
        .rc-master-login-root .btn:active {
          transform: translateY(1px);
        }
        .rc-master-login-root .btn:disabled {
          opacity: 0.7;
          cursor: wait;
        }

        .rc-master-login-root .status {
          margin-bottom: 14px;
          padding: 10px 12px;
          border-radius: 10px;
          font-size: 12.8px;
          text-align: center;
          background: rgba(255, 200, 75, 0.12);
          border: 1px solid rgba(255, 200, 75, 0.45);
          color: #ffe7a3;
        }
        .rc-master-login-root .status.error {
          background: rgba(244, 63, 94, 0.14);
          border-color: rgba(244, 63, 94, 0.55);
          color: #fda4af;
        }
        .rc-master-login-root .status.ok {
          background: rgba(16, 185, 129, 0.14);
          border-color: rgba(16, 185, 129, 0.55);
          color: #6ee7b7;
        }
      `}</style>

      {/* ================= LATAR GELOMBANG EMAS ================= */}
      <div className="bg" aria-hidden="true">
        <div className="orb orb-tl" />
        <div className="orb orb-br" />

        {/* Gelombang emas atas */}
        <svg className="bg-top" viewBox="0 0 900 620" preserveAspectRatio="xMinYMin slice" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="rcMasterGArc" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="900" y2="0">
              <stop offset="0" stopColor="#fff3c4" stopOpacity="1" />
              <stop offset="0.32" stopColor="#ffc844" stopOpacity="0.95" />
              <stop offset="0.7" stopColor="#e59a18" stopOpacity="0.45" />
              <stop offset="1" stopColor="#ffc844" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="rcMasterGStreakL" gradientUnits="userSpaceOnUse" x1="0" y1="520" x2="520" y2="0">
              <stop offset="0" stopColor="#ffb422" stopOpacity="0.2" />
              <stop offset="0.55" stopColor="#ffd76e" stopOpacity="1" />
              <stop offset="1" stopColor="#fff4c8" stopOpacity="1" />
            </linearGradient>
            <filter id="rcMasterGlowA" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="5" result="b" />
              <feMerge>
                <feMergeNode in="b" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            <filter id="rcMasterBlurBig" x="-30%" y="-30%" width="160%" height="160%">
              <feGaussianBlur stdDeviation="24" />
            </filter>
          </defs>
          <g className="wave-float slow">
            <path d="M-40,470 C80,240 240,90 470,-30" fill="none" stroke="url(#rcMasterGStreakL)" strokeWidth="42" opacity="0.22" filter="url(#rcMasterBlurBig)" />
            <path d="M-40,510 C90,260 240,100 450,-30" fill="none" stroke="url(#rcMasterGStreakL)" strokeWidth="4.2" filter="url(#rcMasterGlowA)" />
            <path d="M-40,450 C70,220 220,70 420,-30" fill="none" stroke="url(#rcMasterGStreakL)" strokeWidth="2.4" opacity="0.9" filter="url(#rcMasterGlowA)" />
            <path d="M-40,390 C60,190 200,50 380,-30" fill="none" stroke="url(#rcMasterGStreakL)" strokeWidth="1.3" opacity="0.65" />
            <path d="M-30,360 C190,190 470,70 760,30 C830,20 880,22 930,32" fill="none" stroke="url(#rcMasterGArc)" strokeWidth="3.2" filter="url(#rcMasterGlowA)" />
            <path d="M-30,400 C210,225 490,105 780,62 C850,52 895,55 930,64" fill="none" stroke="url(#rcMasterGArc)" strokeWidth="1.5" opacity="0.7" />
          </g>
          <g fill="#ffe9a6">
            <circle className="spark" cx="110" cy="95" r="2.2" />
            <circle className="spark" cx="240" cy="60" r="1.6" />
            <circle className="spark" cx="310" cy="175" r="1.8" />
            <circle className="spark" cx="70" cy="260" r="1.5" />
            <circle className="spark" cx="540" cy="95" r="1.7" />
          </g>
        </svg>

        {/* Gelombang emas bawah */}
        <svg className="bg-bottom" viewBox="0 900 900 900" preserveAspectRatio="xMaxYMax slice" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="rcMasterGSweep" gradientUnits="userSpaceOnUse" x1="900" y1="1000" x2="0" y2="1780">
              <stop offset="0" stopColor="#fff3c2" stopOpacity="1" />
              <stop offset="0.45" stopColor="#ffc844" stopOpacity="0.95" />
              <stop offset="0.85" stopColor="#df9215" stopOpacity="0.75" />
              <stop offset="1" stopColor="#ffc844" stopOpacity="0.15" />
            </linearGradient>
            <filter id="rcMasterGlowB" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="6" result="b" />
              <feMerge>
                <feMergeNode in="b" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            <filter id="rcMasterBlurBig2" x="-30%" y="-30%" width="160%" height="160%">
              <feGaussianBlur stdDeviation="28" />
            </filter>
          </defs>
          <g className="wave-float">
            <path d="M930,990 C900,1170 800,1300 640,1390 C470,1485 250,1510 -20,1600" fill="none" stroke="url(#rcMasterGSweep)" strokeWidth="76" opacity="0.30" filter="url(#rcMasterBlurBig2)" />
            <path d="M-20,1610 C100,1545 260,1565 420,1625 C560,1675 760,1705 930,1695" fill="none" stroke="url(#rcMasterGSweep)" strokeWidth="48" opacity="0.26" filter="url(#rcMasterBlurBig2)" />
            <path d="M930,980 C900,1160 800,1290 640,1380 C470,1475 250,1500 -20,1590" fill="none" stroke="url(#rcMasterGSweep)" strokeWidth="4.2" filter="url(#rcMasterGlowB)" />
            <path d="M930,1030 C890,1200 780,1320 620,1410 C450,1500 230,1530 -20,1640" fill="none" stroke="url(#rcMasterGSweep)" strokeWidth="2.4" opacity="0.88" filter="url(#rcMasterGlowB)" />
            <path d="M-20,1610 C100,1540 260,1560 420,1620 C560,1670 760,1700 930,1690" fill="none" stroke="url(#rcMasterGSweep)" strokeWidth="3" filter="url(#rcMasterGlowB)" />
            <path d="M930,1330 C800,1420 700,1520 590,1650" fill="none" stroke="url(#rcMasterGSweep)" strokeWidth="3.2" filter="url(#rcMasterGlowB)" />
          </g>
          <g fill="#ffd978">
            <circle className="spark" cx="860" cy="1060" r="2.2" />
            <circle className="spark" cx="780" cy="1230" r="1.6" />
            <circle className="spark" cx="150" cy="1560" r="1.8" />
            <circle className="spark" cx="560" cy="1680" r="1.5" />
          </g>
        </svg>

        <div className="dust-layer">
          {Array.from({ length: 24 }).map((_, i) => {
            const size = 1.8 + ((i * 7) % 26) / 10;
            const left = ((i * 37) % 98) + 1;
            const dur = 10 + ((i * 13) % 12);
            const delay = -((i * 19) % 20);
            const sx = ((i * 23) % 80) - 40;
            return (
              <span
                key={i}
                className="dust"
                style={
                  {
                    left: `${left}%`,
                    width: `${size}px`,
                    height: `${size}px`,
                    animationDuration: `${dur}s`,
                    animationDelay: `${delay}s`,
                    '--sx': `${sx}px`,
                  } as React.CSSProperties
                }
              />
            );
          })}
        </div>
      </div>

      {/* ================= KONTEN LOGIN ================= */}
      <main className="page">
        <div className="wrap">
          {/* Logo RiskCart */}
          <header
            translate="no"
            data-no-translate="true"
            className="brand notranslate bg-transparent"
            style={{ background: 'transparent', backgroundColor: 'transparent' }}
            aria-label="POS RiskCart Artificial Intelligence"
          >
            <svg className="brand-mark" viewBox="-8 -8 124 126" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="POS">
              <defs>
                <linearGradient id="rcMasterHexGold" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0" stopColor="#fff0b8" />
                  <stop offset="0.45" stopColor="#ffc83a" />
                  <stop offset="1" stopColor="#d98d12" />
                </linearGradient>
                <linearGradient id="rcMasterPosWhite" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="#ffffff" />
                  <stop offset="1" stopColor="#c9c9c9" />
                </linearGradient>
              </defs>
              <path d="M100,27 L50,0 L0,27 L0,83 L50,110 L100,83" fill="none" stroke="url(#rcMasterHexGold)" strokeWidth="7" strokeLinejoin="round" strokeLinecap="round" />
              <path d="M92,33 L50,10 L9,33 L9,77 L50,100 L92,77" fill="none" stroke="url(#rcMasterHexGold)" strokeWidth="1.6" opacity="0.55" strokeLinejoin="round" strokeLinecap="round" />
              <text x="55" y="70" textAnchor="middle" fontFamily="Inter, system-ui, sans-serif" fontWeight="900" fontSize="46" letterSpacing="-2.5" fill="url(#rcMasterPosWhite)">POS</text>
            </svg>
            <span className="brand-divider" />
            <div translate="no" data-no-translate="true" className="brand-text notranslate">
              <span className="brand-name notranslate">
                Risk<span className="cart notranslate">Cart</span>
              </span>
              <span className="brand-sub notranslate">Artificial Intelligence</span>
            </div>
          </header>

          {/* Kartu Login */}
          <section className="card" aria-labelledby="loginTitle">
            <h1 className="title" id="loginTitle">Welcome Back</h1>
            <p className="sub">Sign in to your account to continue</p>

            <form id="loginForm" noValidate onSubmit={handleSubmit}>
              <div className="field">
                <label htmlFor="email">Email / Username</label>
                <div className="input">
                  <svg className="ico" viewBox="0 0 24 24" aria-hidden="true">
                    <rect x="3" y="5" width="18" height="14" rx="2.5" />
                    <path d="M3.5 6.5 12 13l8.5-6.5" />
                  </svg>
                  <input
                    id="email"
                    name="email"
                    type="text"
                    inputMode="email"
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      if (statusMessage) setStatusMessage(null);
                    }}
                    placeholder="panglimabesarisis@gmail.com / demo@mayamandiri.com"
                    autoComplete="username"
                    required
                  />
                </div>
              </div>

              <div className="field">
                <label htmlFor="password">Password / PIN POS</label>
                <div className="input">
                  <svg className="ico" viewBox="0 0 24 24" aria-hidden="true">
                    <rect x="4" y="11" width="16" height="10" rx="2.5" />
                    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
                  </svg>
                  <input
                    id="password"
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      if (statusMessage) setStatusMessage(null);
                    }}
                    placeholder="Masukkan Password (Demo123) atau PIN (123456)"
                    autoComplete="current-password"
                    required
                  />
                  <button
                    type="button"
                    className="eye"
                    id="togglePw"
                    onClick={() => setShowPassword((prev) => !prev)}
                    aria-label="Show or hide password"
                  >
                    {showPassword ? (
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M3 3l18 18" />
                        <path d="M10.6 10.6a3 3 0 0 0 4.2 4.2" />
                        <path d="M9.9 5.1A10.7 10.7 0 0 1 12 5c6.5 0 10 7 10 7a18.4 18.4 0 0 1-4.1 5.1" />
                        <path d="M6.2 6.2C3.8 8 2 12 2 12s3.5 7 10 7c1.8 0 3.4-.5 4.8-1.2" />
                      </svg>
                    ) : (
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                    )}
                  </button>
                </div>
              </div>

              <div className="demo-forgot-row">
                <div className="demo-info">
                  <span className="demo-title">AKSES CEPAT OWNER & DEMO</span>
                  <span className="demo-pin">
                    Pass: <strong>Demo123</strong> | PIN POS: <strong>123456</strong>
                  </span>
                </div>
                <button
                  type="button"
                  className="forgot"
                  id="forgotLink"
                  onClick={handleFillDemo}
                >
                  Isi Form Owner
                </button>
              </div>

              {statusMessage && (
                <div
                  className={`status ${
                    statusMessage.type === 'error'
                      ? 'error'
                      : statusMessage.type === 'ok'
                      ? 'ok'
                      : ''
                  }`}
                  role="status"
                  aria-live="polite"
                >
                  {statusMessage.text}
                </div>
              )}

              {/* Pintasan 1-Klik Login Cepat Owner Utama & Akun Demo */}
              <div className="mb-3 p-3 rounded-xl border border-amber-400/35 bg-amber-500/5 space-y-2">
                <div className="text-[11px] font-extrabold uppercase tracking-wider text-amber-300 text-center">
                  🔑 Login Cepat 1-Klik (Owner Live Database & Demo)
                </div>
                <button
                  type="button"
                  id="masterOwnerBtn"
                  disabled={isSubmitting}
                  onClick={() => void handleQuickDemoLogin('owner')}
                  className="btn-demo !mb-0 !h-auto w-full py-2.5 px-3 flex flex-col items-center justify-center text-center border-amber-400/70 bg-amber-500/15 hover:bg-amber-500/25"
                  title="Login 1-Klik sebagai Owner Utama Live Database (panglimabesarisis@gmail.com | Demo123 / 123456)"
                >
                  <span className="text-xs font-extrabold text-amber-200 leading-tight">
                    ⚡ Login Owner Utama (Live Database)
                  </span>
                  <span className="text-[10px] font-mono text-amber-100/85">
                    panglimabesarisis@gmail.com • Pass: Demo123 / PIN: 123456
                  </span>
                </button>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    id="demoAdminBtn"
                    disabled={isSubmitting}
                    onClick={() => void handleQuickDemoLogin('admin')}
                    className="btn-demo !mb-0 !h-auto py-2 px-2.5 flex flex-col items-center justify-center text-center"
                    title="Login 1-Klik sebagai Demo Admin / Owner (demo@mayamandiri.com | Demo123)"
                  >
                    <span className="text-xs font-extrabold text-amber-200 leading-tight">
                      👑 Demo Admin / Owner
                    </span>
                    <span className="text-[10px] font-mono text-amber-100/75">
                      demo@mayamandiri.com
                    </span>
                  </button>
                  <button
                    type="button"
                    id="demoKasirBtn"
                    disabled={isSubmitting}
                    onClick={() => void handleQuickDemoLogin('kasir')}
                    className="btn-demo !mb-0 !h-auto py-2 px-2.5 flex flex-col items-center justify-center text-center"
                    title="Login 1-Klik sebagai Demo Kasir (kasir@mayamandiri.com | Demo123)"
                  >
                    <span className="text-xs font-extrabold text-emerald-300 leading-tight">
                      🛒 Demo Kasir POS
                    </span>
                    <span className="text-[10px] font-mono text-amber-100/75">
                      kasir@mayamandiri.com
                    </span>
                  </button>
                </div>
              </div>

              <button
                type="submit"
                className="btn"
                id="submitBtn"
                disabled={isSubmitting}
              >
                {isSubmitting ? 'Signing In...' : 'Sign In'}
              </button>

              <a
                href="https://riskcart.ai.studio/client-pwa"
                id="clientAppOrderBtn"
                onClick={(e) => {
                  e.preventDefault();
                  if (
                    typeof window !== 'undefined' &&
                    window.location.hostname === 'riskcart.ai.studio'
                  ) {
                    window.location.href = 'https://riskcart.ai.studio/client-pwa';
                  } else {
                    navigate('/client-pwa');
                  }
                }}
                className="btn-demo !mt-3 !mb-0 !h-[48px] w-full flex items-center justify-center gap-2 text-sm font-extrabold tracking-wide no-underline"
                title="https://riskcart.ai.studio/client-pwa"
              >
                <span>🛍️ Client App Order</span>
                <span className="text-xs opacity-80">→</span>
              </a>
            </form>
          </section>
        </div>
      </main>
    </div>
  );
};
