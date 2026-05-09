import React, { useState, useRef } from 'react';
import { Button } from './ui/button';
import { Mic, StopCircle } from 'lucide-react';
import { toast } from 'sonner@2.0.3';

interface TranscriptionButtonProps {
  deepgramApiKey: string;
  onTranscript: (text: string) => void;
}

export function TranscriptionButton({ deepgramApiKey, onTranscript }: TranscriptionButtonProps) {
  const [isRecording, setIsRecording] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const stopTranscription = (silent = false) => {
    if (mediaRecorderRef.current?.state !== 'inactive') {
      mediaRecorderRef.current?.stop();
    }
    wsRef.current?.close();
    streamRef.current?.getTracks().forEach(t => t.stop());
    mediaRecorderRef.current = null;
    wsRef.current = null;
    streamRef.current = null;
    setIsRecording(false);
    if (!silent) toast.info('書き起こしを停止しました');
  };

  const startTranscription = async () => {
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
        toast.error('音声が取得できませんでした。画面共有ダイアログで「タブの音声を共有」を有効にしてください。');
        return;
      }

      streamRef.current = stream;
      const audioStream = new MediaStream(audioTracks);

      const params = new URLSearchParams({
        language: 'ja',
        model: 'nova-2',
        smart_format: 'true',
        interim_results: 'true',
        punctuate: 'true',
      });

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
        toast.success('書き起こしを開始しました');
      };

      ws.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data as string);
          if (
            data.type === 'Results' &&
            data.is_final &&
            data.channel?.alternatives?.[0]?.transcript
          ) {
            const transcript = (data.channel.alternatives[0].transcript as string).trim();
            if (transcript) {
              onTranscript(transcript);
            }
          }
        } catch {
          // ignore parse errors
        }
      };

      ws.onerror = () => {
        toast.error('Deepgram接続エラーが発生しました');
        stopTranscription(true);
      };

      ws.onclose = () => {
        setIsRecording(false);
      };

      // ユーザーが画面共有を停止したとき
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
      size="sm"
      onClick={isRecording ? () => stopTranscription() : startTranscription}
      className={isRecording
        ? 'bg-red-500 hover:bg-red-600 text-white gap-1.5'
        : 'bg-indigo-600 hover:bg-indigo-700 text-white gap-1.5'
      }
    >
      {isRecording
        ? <><StopCircle className="w-4 h-4" />停止</>
        : <><Mic className="w-4 h-4" />自動書き起こし</>
      }
    </Button>
  );
}
