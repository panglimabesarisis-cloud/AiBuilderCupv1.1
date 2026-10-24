import React, { useState, useEffect } from 'react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../../firebase';
import { StoreConfig } from '../../types';
import { ACTIVE_STORE_ID } from '../../config/store';
import { DEFAULT_STORE_CONFIG } from '../../services/dataSeeder';
import {
  Settings,
  MapPin,
  Shield,
  Save,
  CheckCircle,
  Database,
  Building,
  Navigation,
  Globe,
} from 'lucide-react';

export const PwaSettings: React.FC = () => {
  const [config, setConfig] = useState<StoreConfig>(DEFAULT_STORE_CONFIG);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  useEffect(() => {
    async function loadConfig() {
      try {
        const docSnap = await getDoc(doc(db, 'stores', ACTIVE_STORE_ID));
        if (docSnap.exists()) {
          setConfig(docSnap.data() as StoreConfig);
        }
      } catch (error) {
        handleFirestoreError(error, OperationType.GET, `stores/${ACTIVE_STORE_ID}`);
      }
    }
    loadConfig();
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      await setDoc(
        doc(db, 'stores', ACTIVE_STORE_ID),
        {
          ...config,
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      );
      setStatusMsg('Store calibration & anti-fraud settings saved successfully.');
      setTimeout(() => setStatusMsg(null), 3500);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `stores/${ACTIVE_STORE_ID}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleGetCurrentLocation = () => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setConfig((prev) => ({
            ...prev,
            latitude: Number(pos.coords.latitude.toFixed(6)),
            longitude: Number(pos.coords.longitude.toFixed(6)),
          }));
          setStatusMsg('Calibrated store GPS to your current browser coordinates.');
          setTimeout(() => setStatusMsg(null), 3500);
        },
        (err) => {
          setStatusMsg('Izin GPS terbatas di browser (' + err.message + '). Menggunakan koordinat pusat demo.');
          setTimeout(() => setStatusMsg(null), 3500);
        }
      );
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {statusMsg && (
        <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs flex items-center gap-2">
          <CheckCircle className="w-4 h-4 text-emerald-400" />
          <span>{statusMsg}</span>
        </div>
      )}

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
          <Settings className="w-6 h-6 text-zinc-400" />
          Store &amp; Anti-Fraud Calibration
        </h1>
        <p className="text-sm text-zinc-400 mt-1">
          Configure physical Geofence perimeter, Multi-Tenant SaaS parameters, and risk thresholds.
        </p>
      </div>

      <form onSubmit={handleSave} className="space-y-6">
        {/* Multi-Tenant SaaS Identification */}
        <div className="bg-zinc-900/90 border border-zinc-800 rounded-2xl p-6 shadow-xl space-y-4">
          <h2 className="text-sm font-bold text-white flex items-center gap-2">
            <Building className="w-4 h-4 text-blue-400" />
            Multi-Tenant SaaS Store Metadata
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            <div>
              <label className="block text-zinc-400 mb-1 font-medium">Tenant Store ID (Foreign Key)</label>
              <input
                type="text"
                disabled
                value={config.id}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-2.5 text-zinc-400 font-mono"
              />
              <span className="text-[10px] text-zinc-500 mt-1 block">
                Pre-indexed on all Firestore collections for immediate multi-tenant scale.
              </span>
            </div>

            <div>
              <label className="block text-zinc-400 mb-1 font-medium">Store Display Name</label>
              <input
                type="text"
                value={config.name}
                onChange={(e) => setConfig({ ...config, name: e.target.value })}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-2.5 text-white focus:outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block text-zinc-400 mb-1 font-medium">Store Administrator Email</label>
              <input
                type="email"
                value={config.ownerEmail}
                onChange={(e) => setConfig({ ...config, ownerEmail: e.target.value })}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-2.5 text-white focus:outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block text-zinc-400 mb-1 font-medium">Operating Currency</label>
              <select
                value={config.currency}
                onChange={(e) => setConfig({ ...config, currency: e.target.value })}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-2.5 text-white focus:outline-none focus:border-blue-500"
              >
                <option value="USD">USD ($ - US Dollar)</option>
                <option value="IDR">IDR (Rp - Indonesian Rupiah)</option>
                <option value="SGD">SGD (S$ - Singapore Dollar)</option>
              </select>
            </div>
          </div>
        </div>

        {/* GPS Geofence Perimeter Calibration */}
        <div className="bg-zinc-900/90 border border-zinc-800 rounded-2xl p-6 shadow-xl space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-white flex items-center gap-2">
              <MapPin className="w-4 h-4 text-rose-400" />
              Physical Geofence Calibration
            </h2>

            <button
              type="button"
              onClick={handleGetCurrentLocation}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs font-medium text-zinc-200 transition"
            >
              <Navigation className="w-3.5 h-3.5 text-blue-400" />
              Use My Current GPS
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            <div>
              <label className="block text-zinc-400 mb-1 font-medium">Store Latitude</label>
              <input
                type="number"
                step="0.000001"
                value={config.latitude}
                onChange={(e) => setConfig({ ...config, latitude: Number(e.target.value) })}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-2.5 text-white font-mono"
              />
            </div>

            <div>
              <label className="block text-zinc-400 mb-1 font-medium">Store Longitude</label>
              <input
                type="number"
                step="0.000001"
                value={config.longitude}
                onChange={(e) => setConfig({ ...config, longitude: Number(e.target.value) })}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-2.5 text-white font-mono"
              />
            </div>

            <div className="sm:col-span-2 space-y-2">
              <div className="flex justify-between">
                <label className="text-zinc-400 font-medium">Allowed Geofence Radius (Meters):</label>
                <span className="font-mono text-emerald-400 font-bold">{config.geofenceRadiusMeters} meters</span>
              </div>
              <input
                type="range"
                min="100"
                max="3000"
                step="50"
                value={config.geofenceRadiusMeters}
                onChange={(e) => setConfig({ ...config, geofenceRadiusMeters: Number(e.target.value) })}
                className="w-full accent-emerald-500"
              />
              <span className="text-[10px] text-zinc-500 block">
                Customers checking out from mobile PWA beyond this radius are automatically flagged for manual cashier review.
              </span>
            </div>
          </div>
        </div>

        {/* Anti-Fraud Risk Sensitivity */}
        <div className="bg-zinc-900/90 border border-zinc-800 rounded-2xl p-6 shadow-xl space-y-4">
          <h2 className="text-sm font-bold text-white flex items-center gap-2">
            <Shield className="w-4 h-4 text-amber-400" />
            AI Fraud Interception Threshold
          </h2>

          <div className="space-y-3 text-xs">
            <div className="flex justify-between">
              <label className="text-zinc-400 font-medium">Interception Score Threshold (0 - 100):</label>
              <span className="font-mono text-amber-400 font-bold">Score &gt; {config.fraudThresholdScore}</span>
            </div>
            <input
              type="range"
              min="40"
              max="90"
              value={config.fraudThresholdScore}
              onChange={(e) => setConfig({ ...config, fraudThresholdScore: Number(e.target.value) })}
              className="w-full accent-amber-500"
            />
            <span className="text-[10px] text-zinc-500 block">
              Orders receiving an AI risk score above this threshold will require manager approval before stock deduction.
            </span>
          </div>
        </div>

        {/* Buttons */}
        <div className="flex items-center justify-end pt-2">
          <button
            type="submit"
            disabled={isSaving}
            className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold transition shadow-lg shadow-blue-600/30"
          >
            <Save className="w-4 h-4" />
            {isSaving ? 'Saving...' : 'Save Configuration'}
          </button>
        </div>
      </form>
    </div>
  );
};
