"use client";

import { RecordingPanel } from "./voice-studio/recording-panel";
import { TtsPanel } from "./voice-studio/tts-panel";
import { useVoiceStudioState } from "./voice-studio/use-voice-studio-state";
import { WorkspaceHeader } from "./voice-studio/workspace-header";
import { AppHeader } from "./app-header";

export function VoiceStudio() {
  const studio = useVoiceStudioState();

  return (
    <main className="flex min-h-screen w-full min-w-0 flex-col overflow-x-hidden">
      <AppHeader />
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