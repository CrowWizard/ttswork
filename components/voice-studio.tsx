"use client";

import { useEffect, useId, useRef, useState } from "react";
import { RecordingPanel } from "./voice-studio/recording-panel";
import { TtsPanel } from "./voice-studio/tts-panel";
import { useVoiceStudioState } from "./voice-studio/use-voice-studio-state";
import { WorkspaceHeader } from "./voice-studio/workspace-header";
import { AuthPanel } from "./voice-studio/auth-panel";
import { UserHeader } from "./voice-studio/user-header";

export function VoiceStudio() {
  const studio = useVoiceStudioState();
  const [showLoginModal, setShowLoginModal] = useState(false);
  const dialogTitleId = useId();
  const dialogDescriptionId = useId();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const lastFocusedElementRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const handleOpenLogin = () => {
      lastFocusedElementRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setShowLoginModal(true);
    };

    window.addEventListener("open-voice-login-modal", handleOpenLogin);
    return () => window.removeEventListener("open-voice-login-modal", handleOpenLogin);
  }, []);

  useEffect(() => {
    if (studio.header.authUser) {
      setShowLoginModal(false);
    }
  }, [studio.header.authUser]);

  useEffect(() => {
    if (!showLoginModal) {
      lastFocusedElementRef.current?.focus();
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const focusFirstField = window.setTimeout(() => {
      const focusable = dialogRef.current?.querySelector<HTMLElement>(
        'input:not([disabled]), button:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      focusable?.focus();
    }, 0);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setShowLoginModal(false);
        return;
      }

      if (event.key !== "Tab" || !dialogRef.current) {
        return;
      }

      const focusableElements = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );

      if (!focusableElements.length) {
        return;
      }

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];

      if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
      } else if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.clearTimeout(focusFirstField);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [showLoginModal]);

  return (
    <main className="flex min-h-screen w-full min-w-0 flex-col overflow-x-hidden">
      <UserHeader {...studio.header} />
      {showLoginModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-text-primary/50 px-4 py-6" onClick={() => setShowLoginModal(false)}>
          <div
            ref={dialogRef}
            className="app-card w-full max-w-md p-6 shadow-2xl sm:p-8"
            role="dialog"
            aria-modal="true"
            aria-labelledby={dialogTitleId}
            aria-describedby={dialogDescriptionId}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <h2 id={dialogTitleId} className="text-xl font-semibold">登录后使用积分生成语音</h2>
                <p id={dialogDescriptionId} className="mt-2 text-sm leading-6 text-text-muted">
                  登录后获赠 100 积分；每次生成消耗 20 积分，余额不足时可在顶部输入使用码兑换。
                </p>
              </div>
              <button
                type="button"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-border-subtle text-text-muted transition hover:bg-surface-muted hover:text-text-primary"
                onClick={() => setShowLoginModal(false)}
                aria-label="关闭登录弹窗"
              >
                ×
              </button>
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
            <button type="button" className="mt-5 flex min-h-11 w-full items-center justify-center text-center text-sm text-text-muted underline-offset-4 transition hover:text-text-primary hover:underline" onClick={() => setShowLoginModal(false)}>
              取消
            </button>
          </div>
        </div>
      )}
      <div className="mx-auto flex w-full min-w-0 max-w-5xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-10">
        <WorkspaceHeader />
        <section className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
          <RecordingPanel {...studio.recordingPanel} />
          <TtsPanel {...studio.ttsPanel} />
        </section>
      </div>
    </main>
  );
}
