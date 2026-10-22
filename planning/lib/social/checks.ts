// Lo que la app puede revisar antes de programar (las mismas reglas que usa el publicador)
import type { Network } from "../types";
import type { MediaItem, PostToPublish } from "./common";
import { instagram } from "./instagram";
import { linkedin } from "./linkedin";
import { tiktok } from "./tiktok";

const P = { instagram, linkedin, tiktok };

export function checkFor(network: Network, post: PostToPublish, media: MediaItem[]) {
  return P[network].check(post, media);
}
