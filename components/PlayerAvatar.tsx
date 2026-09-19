interface PlayerAvatarProps {
  imageUrl?: string | null;
  name?: string | null;
  size?: "xs" | "sm" | "md" | "lg";
}

export default function PlayerAvatar({
  imageUrl,
  name,
  size = "sm",
}: PlayerAvatarProps) {
  const sizes = {
    xs: "w-5 h-5 text-[7px]",
    sm: "w-7 h-7 text-[9px]",
    md: "w-9 h-9 text-[11px]",
    lg: "w-12 h-12 text-sm",
  };

  const initial = name?.trim()?.charAt(0)?.toUpperCase() || "?";

  return (
    <div
      className={`
        ${sizes[size]}
        shrink-0
        rounded-full
        overflow-hidden
        border
        border-slate-300
        bg-slate-200
        flex
        items-center
        justify-center
        font-black
        text-slate-600
      `}
    >
      {imageUrl ? (
        <img
          src={imageUrl}
          alt={name || "Player"}
          className="w-full h-full object-cover"
        />
      ) : (
        <span>{initial}</span>
      )}
    </div>
  );
}
