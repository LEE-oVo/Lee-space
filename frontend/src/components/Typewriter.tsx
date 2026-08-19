import { useEffect, useState } from 'react';

interface Props {
  phrases: string[];
  speed?: number;
}

/** 循环打字机效果 */
export default function Typewriter({ phrases, speed = 90 }: Props) {
  const [text, setText] = useState('');
  const [phraseIndex, setPhraseIndex] = useState(0);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    const current = phrases[phraseIndex % phrases.length];
    let timer: number;

    if (!deleting && text === current) {
      timer = window.setTimeout(() => setDeleting(true), 1800);
    } else if (deleting && text === '') {
      setDeleting(false);
      setPhraseIndex((i) => (i + 1) % phrases.length);
      return;
    } else {
      timer = window.setTimeout(
        () => {
          setText(
            deleting
              ? current.slice(0, text.length - 1)
              : current.slice(0, text.length + 1),
          );
        },
        deleting ? speed / 2 : speed,
      );
    }
    return () => clearTimeout(timer);
  }, [text, deleting, phraseIndex, phrases, speed]);

  return <span className="type-cursor">{text}</span>;
}
