/**
 * useProgress.ts
 * Hook trả về streak/goal/hoạt động sống, tự cập nhật khi bumpActivity/setGoal.
 */

import { useState, useEffect } from "react";
import {
  Progress,
  getProgress,
  loadProgress,
  subscribeProgress,
} from "./progress-store";

export function useProgress() {
  const [progress, setProgress] = useState<Progress>(getProgress());
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let mounted = true;
    loadProgress().then((p) => {
      if (mounted) {
        setProgress(p);
        setLoaded(true);
      }
    });
    const unsub = subscribeProgress((p) => setProgress(p));
    return () => {
      mounted = false;
      unsub();
    };
  }, []);

  return { progress, loaded };
}
