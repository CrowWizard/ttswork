"use client";

import { useEffect, useState } from "react";
import { RecordingPanel } from "./voice-studio/recording-panel";
import { TtsPanel } from "./voice-studio/tts-panel";
import { useVoiceStudioState } from "./voice-studio/use-voice-studio-state";
import { WorkspaceHeader } from "./voice-studio/workspace-header";
import { AuthPanel } from "./voice-studio/auth-panel";

export function VoiceStudio() {
  const studio = useVoiceStudioState();
  const [showLoginModal, setShowLoginModal] = useState(false);

  useEffect(() => {
    const handleOpenLogin = () => setShowLoginModal(true);
    window.addEventListener("open-voice-login-modal", handleOpenLogin);
    return () => window.removeEventListener("open-voice-login-modal", handleOpenLogin);
  }, []);

  useEffect(() => {
    if (studio.header.authUser) {
      setShowLoginModal(false);
    }
  }, [studio.header.authUser]);

  return (
    <main className="flex min-h-screen w-full min-w-0 flex-col items-center justify-center overflow-x-hidden px-4 py-12 sm:px-6">
      {showLoginModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowLoginModal(false)}>
          <div className="app-card w-full max-w-md p-6 sm:p-8" onClick={(e) => e.stopPropagation()}>
            <div className="text-center mb-4">
              <h2 className="text-xl font-semibold">登录后无限使用</h2>
              <p className="mt-2 text-sm text-text-muted">未登录可试用1次，限30字内</p>
            </div>
            <AuthPanel
              {...studio.authPanel}
              onSubmitSmsLogin={() => {
                studio.authPanel.onSubmitSmsLogin();
              }}
              onSubmitPasswordLogin={() => {
                studio.authPanel.onSubmitPasswordLogin();
              }}
            />
            <button type="button" className="mt-4 w-full text-center text-sm text-text-muted" onClick={() => setShowLoginModal(false)}>
              取消
            </button>
          </div>
        </div>
      )}
      <div className="mx-auto w-full min-w-0 max-w-5xl">
        <WorkspaceHeader {...studio.header} />
        <section className="mt-8 grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
          <RecordingPanel {...studio.recordingPanel} />
          <TtsPanel {...studio.ttsPanel} />
        </section>
      </div>
    </main>
  );
}
