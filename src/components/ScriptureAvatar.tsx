import { accessoryFor } from "@/lib/avatarAccessories";
import { getCharacterAsset } from "@/lib/characterAssets";
import type { AvatarAppearance } from "@/lib/avatarTypes";

export function ScriptureAvatar({ appearance, handle, className = "", label }: { appearance: AvatarAppearance; handle: string; className?: string; label?: string }) {
  const character = getCharacterAsset(appearance.avatarCharacterId);
  const background = accessoryFor(appearance.avatarBackgroundId);
  const frame = accessoryFor(appearance.avatarFrameId);
  const decoration = accessoryFor(appearance.avatarDecorationId);
  const light = accessoryFor(appearance.avatarLightAccentId);
  const hasAccessory = Boolean(background || frame || decoration || light);
  const fallbackText = appearance.avatarEmoji || Array.from(handle.trim()).slice(0, 2).join("").toUpperCase();

  if (!character?.avatarAllowed && !hasAccessory) {
    return (
      <span className={`flex items-center justify-center rounded-full font-extrabold leading-none ${className}`} aria-hidden={label ? undefined : true} aria-label={label}>
        {fallbackText}
      </span>
    );
  }

  return (
    <span className={`relative isolate overflow-hidden rounded-full bg-vs-subtle ${className}`} aria-hidden={label ? undefined : true} aria-label={label}>
      {background && <Layer src={background.compact} alt="" className="z-0 object-cover" />}
      {character?.avatarAllowed ? <Layer src={character.avatar} alt="" className="z-10 object-contain" /> : <span className="absolute inset-0 z-10 flex items-center justify-center font-extrabold leading-none">{fallbackText}</span>}
      {light && <Layer src={light.compact} alt="" className="z-20 object-contain" />}
      {decoration && <Layer src={decoration.compact} alt="" className="z-30 object-contain" />}
      {frame && <Layer src={frame.compact} alt="" className="z-40 object-contain" />}
    </span>
  );
}

function Layer({ src, alt, className }: { src: string; alt: string; className: string }) {
  // De lagen zijn transparante, vooraf uitgelijnde bestanden; next/image zou
  // hier een onbedoelde wrapper en eigen cropgeometrie introduceren.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} draggable={false} className={`pointer-events-none absolute inset-0 h-full w-full ${className}`} />;
}

export default ScriptureAvatar;
