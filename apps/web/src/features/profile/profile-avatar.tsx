import { useEffect, useState } from "react";

type ProfileAvatarProps = Readonly<{
  displayName: string;
  url: string | null;
  size?: "small" | "large";
}>;

function displayInitial(displayName: string): string {
  return Array.from(displayName.trim())[0] ?? "?";
}

export function ProfileAvatar({
  displayName,
  url,
  size = "small"
}: ProfileAvatarProps) {
  const [imageFailed, setImageFailed] = useState(false);
  const accessibleName = `รูปโปรไฟล์ของ ${displayName.trim()}`;

  useEffect(() => {
    setImageFailed(false);
  }, [url]);

  if (url && !imageFailed) {
    return (
      <span className={`profile-avatar ${size}`}>
        <img
          src={url}
          alt={accessibleName}
          onError={() => setImageFailed(true)}
        />
      </span>
    );
  }

  return (
    <span
      className={`profile-avatar ${size} fallback`}
      role="img"
      aria-label={accessibleName}
    >
      {displayInitial(displayName)}
    </span>
  );
}
