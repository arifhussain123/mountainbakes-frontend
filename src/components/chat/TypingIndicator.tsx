interface Props {
  typingNames: string[];
}

export function TypingIndicator({ typingNames }: Props) {
  if (!typingNames.length) return null;

  const label =
    typingNames.length === 1
      ? `${typingNames[0]} is typing`
      : typingNames.length === 2
      ? `${typingNames[0]} and ${typingNames[1]} are typing`
      : `${typingNames.length} people are typing`;

  return (
    <div className="flex items-center gap-2 px-4 py-1.5">
      <div className="flex gap-1 items-center">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60 animate-bounce"
            style={{ animationDelay: `${i * 0.15}s`, animationDuration: '0.8s' }}
          />
        ))}
      </div>
      <span className="text-xs text-muted-foreground italic">{label}…</span>
    </div>
  );
}
