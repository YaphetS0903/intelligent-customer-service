type BrowserSpeechOptions = {
  lang?: string;
  onEnd?: () => void;
  onError?: () => void;
};

export function canUseBrowserSpeech() {
  return typeof window !== "undefined" &&
    "speechSynthesis" in window &&
    typeof window.SpeechSynthesisUtterance !== "undefined";
}

export function stopBrowserSpeech() {
  if (!canUseBrowserSpeech()) {
    return;
  }

  window.speechSynthesis.cancel();
}

export function speakWithBrowserSpeech(text: string, options: BrowserSpeechOptions = {}) {
  const content = text.trim().slice(0, 4000);
  if (!content || !canUseBrowserSpeech()) {
    return false;
  }

  stopBrowserSpeech();
  const utterance = new window.SpeechSynthesisUtterance(content);
  utterance.lang = options.lang ?? "zh-CN";
  utterance.rate = 1;
  utterance.pitch = 1;
  utterance.onend = () => options.onEnd?.();
  utterance.onerror = () => options.onError?.();
  window.speechSynthesis.speak(utterance);
  return true;
}
