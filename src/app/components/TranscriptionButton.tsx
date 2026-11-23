import React, { useState, useRef, useEffect } from 'react';
import { Button } from './ui/button';
import { Mic, StopCircle } from 'lucide-react';
import { toast } from 'sonner@2.0.3';
import { loadDictionaryTerms } from './DictionaryDialog';

interface TranscriptionButtonProps {
  deepgramApiKey: string;
  onTranscript: (text: string) => void;
  onInterimTranscript?: (text: string) => void;
  onTitleFrame?: (base64: string) => void;
  onNewFrame?: (base64: string) => void;
  frameIntervalMs?: number;
  startLabel?: string;
  startDisabled?: boolean;
  beforeStart?: () => boolean;
  onError?: (message: string) => void;
  onRecordingChange?: (active: boolean) => void;
}

function computeFrameDiff(prev: ImageData, curr: ImageData): number {
  let total = 0;
  for (let i = 0; i < prev.data.length; i += 4) {
    total += (
      Math.abs(prev.data[i]     - curr.data[i]) +
      Math.abs(prev.data[i + 1] - curr.data[i + 1]) +
      Math.abs(prev.data[i + 2] - curr.data[i + 2])
    ) / (255 * 3);
  }
  return total / (prev.data.length / 4);
}

export function TranscriptionButton({ deepgramApiKey, onTranscript, onInterimTranscript, onNewFrame, onTitleFrame, frameIntervalMs = 10000, startLabel = '自動書き起こし', onRecordingChange, startDisabled, beforeStart, onError }: TranscriptionButtonProps) {
  const [isRecording, setIsRecording] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const videoElRef = useRef<HTMLVideoElement | null>(null);
  const frameIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevFrameDataRef = useRef<ImageData | null>(null);

  const stopTranscription = (silent = false) => {
    if (frameIntervalRef.current) {
      clearInterval(frameIntervalRef.current);
      frameIntervalRef.current = null;
    }
    if (videoElRef.current) {
      videoElRef.current.srcObject = null;
      videoElRef.current = null;
    }
    prevFrameDataRef.current = null;

    if (mediaRecorderRef.current?.state !== 'inactive') {
      mediaRecorderRef.current?.stop();
    }
    wsRef.current?.close();
    streamRef.current?.getTracks().forEach(t => t.stop());
    mediaRecorderRef.current = null;
    wsRef.current = null;
    streamRef.current = null;
    setIsRecording(false);
    onRecordingChange?.(false);
    if (!silent) toast.info('書き起こしを停止しました');
  };

  useEffect(() => () => {
    if (frameIntervalRef.current) clearInterval(frameIntervalRef.current);
    if (videoElRef.current) videoElRef.current.srcObject = null;
    wsRef.current?.close();
    streamRef.current?.getTracks().forEach(track => {
      track.onended = null;
      track.stop();
    });
  }, []);

  const startFrameCapture = (stream: MediaStream) => {
    if (!onNewFrame) return;

    const videoEl = document.createElement('video');
    videoEl.srcObject = stream;
    videoEl.muted = true;
    videoEl.playsInline = true;
    videoEl.play().catch(() => {});
    videoElRef.current = videoEl;

    const captureCanvas = document.createElement('canvas');
    const settings = stream.getVideoTracks()[0]?.getSettings();
    const width = Math.min(settings?.width || 640, frameIntervalMs < 10000 ? 1600 : 640);
    const height = settings?.width && settings?.height ? Math.round(width * settings.height / settings.width) : Math.round(width * 9 / 16);
    captureCanvas.width = width;
    captureCanvas.height = height;
    const captureCtx = captureCanvas.getContext('2d');

    const diffCanvas = document.createElement('canvas');
    diffCanvas.width = 64;
    diffCanvas.height = 36;
    const diffCtx = diffCanvas.getContext('2d');

    if (!captureCtx || !diffCtx) return;

    const liveCapture = frameIntervalMs < 10000;
    let lastCaptureAt = 0;
    let lastTitleCaptureAt = 0;
    let previousTitleBand: ImageData | undefined;
    const titleCanvas = document.createElement('canvas');
    titleCanvas.width = 192;
    titleCanvas.height = 48;
    const titleContext = onTitleFrame ? titleCanvas.getContext('2d', { willReadFrequently: true }) : null;
    const captureFrame = () => {
      const vid = videoElRef.current;
      if (!vid || vid.readyState < 2 || vid.videoWidth === 0) return;

      captureCtx.drawImage(vid, 0, 0, width, height);
      diffCtx.drawImage(vid, 0, 0, 64, 36);
      const curr = diffCtx.getImageData(0, 0, 64, 36);

      const prev = prevFrameDataRef.current;
      const capturedAt = Date.now();
      const sceneChanged = !prev || computeFrameDiff(prev, curr) > (liveCapture ? 0.035 : 0.08) ||
        (liveCapture && capturedAt - lastCaptureAt >= 12000);
      let checkTitle = false;
      if (titleContext) {
        const bandHeight = Math.ceil(height * 0.32);
        titleContext.drawImage(captureCanvas, 0, 0, width, bandHeight, 0, 0, 192, 48);
        const band = titleContext.getImageData(0, 0, 192, 48);
        checkTitle = !previousTitleBand || computeFrameDiff(previousTitleBand, band) > 0.004 ||
          capturedAt - lastTitleCaptureAt >= 12000;
        if (checkTitle) {
          previousTitleBand = band;
          lastTitleCaptureAt = capturedAt;
        }
      }
      if (!sceneChanged && !checkTitle) return;

      const base64 = captureCanvas.toDataURL('image/jpeg', 0.75).split(',')[1];
      if (sceneChanged) {
        prevFrameDataRef.current = curr;
        lastCaptureAt = capturedAt;
        onNewFrame(base64);
      }
      if (checkTitle) onTitleFrame?.(base64);
    };

    frameIntervalRef.current = setInterval(captureFrame, frameIntervalMs);
  };

  const startTranscription = async () => {
    if (beforeStart && !beforeStart()) return;
    if (!deepgramApiKey) {
      toast.error('設定からDeepgram APIキーを入力してください');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
      });

      const audioTracks = stream.getAudioTracks();
      if (audioTracks.length === 0) {
        stream.getTracks().forEach(t => t.stop());
        onError?.('YouTube の音声が共有されていません。');
        toast.error('音声が取得できませんでした。画面共有ダイアログで「タブの音声を共有」を有効にしてください。');
        return;
      }

      streamRef.current = stream;
      startFrameCapture(stream);

      const audioStream = new MediaStream(audioTracks);

      const params = new URLSearchParams({
        language: 'ja',
        model: 'nova-2',
        smart_format: 'true',
        interim_results: 'true',
        punctuate: 'true',
        endpointing: '300',
      });
      (await loadDictionaryTerms()).forEach(term => params.append("keywords", term));

      const ws = new WebSocket(
        `wss://api.deepgram.com/v1/listen?${params}`,
        ['token', deepgramApiKey]
      );
      wsRef.current = ws;

      ws.onopen = () => {
        const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus'
          : 'audio/webm';

        const mediaRecorder = new MediaRecorder(audioStream, { mimeType });
        mediaRecorderRef.current = mediaRecorder;

        mediaRecorder.ondataavailable = (e) => {
          if (e.data.size > 0 && ws.readyState === WebSocket.OPEN) {
            ws.send(e.data);
          }
        };

        mediaRecorder.start(250);
        setIsRecording(true);
        onRecordingChange?.(true);
        toast.success('書き起こしを開始しました');
      };

      ws.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data as string);
          if (data.type === 'Results' && data.channel?.alternatives?.[0]?.transcript) {
            const transcript = (data.channel.alternatives[0].transcript as string).trim();
            if (data.is_final) {
              onInterimTranscript?.('');
              if (transcript) onTranscript(transcript);
            } else {
              onInterimTranscript?.(transcript);
            }
          }
        } catch {
          // ignore parse errors
        }
      };

      ws.onerror = () => {
        onError?.('文字起こしサービスへの接続に失敗しました。');
        toast.error('Deepgram接続エラーが発生しました');
        stopTranscription(true);
      };

      ws.onclose = () => {
        if (wsRef.current === ws) {
          onError?.('文字起こしサービスとの接続が終了しました。');
          stopTranscription(true);
        }
      };

      stream.getTracks().forEach(t => {
        t.onended = () => stopTranscription();
      });
    } catch (err) {
      const error = err as Error;
      if (error.name !== 'NotAllowedError') {
        toast.error(`書き起こし開始に失敗しました: ${error.message}`);
      }
    }
  };

  return (
    <Button
      size="default"
      disabled={!isRecording && startDisabled}
      onClick={isRecording ? () => stopTranscription() : startTranscription}
      className={isRecording
        ? 'bg-red-500 hover:bg-red-600 text-white gap-1.5'
        : 'h-14 gap-2 border border-transparent bg-indigo-600 px-5 text-lg text-white hover:bg-indigo-700 disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-500 disabled:opacity-100'
      }
    >
      {isRecording
        ? <><StopCircle className="w-4 h-4" />停止</>
        : <><Mic className="w-4 h-4" />{startLabel}</>
      }
    </Button>
  );
}
