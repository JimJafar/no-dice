/**
 * The constants from `salient/docs/salient-rules-v0.md`. A match carries its
 * own config so a log can be replayed under the rules it was played by.
 */
export interface Config {
  /** Board radius: the hexes with `|q|`, `|r|` and `|q + r|` all within it. */
  readonly radius: number;
  readonly turns: number;
  readonly actionPoints: number;
  readonly startingTroops: number;
  readonly baseProduction: number;
  readonly nodeProduction: number;
  readonly nodeGarrison: number;
  /** Blocked hexes are placed in pairs, one on each half of the board. */
  readonly blockedPairs: number;
  readonly homeBonus: number;
  readonly points: {
    readonly plain: number;
    readonly node: number;
    readonly base: number;
  };
  readonly supply: boolean;
}

export const DEFAULT_CONFIG: Config = {
  radius: 5,
  turns: 25,
  actionPoints: 6,
  startingTroops: 5,
  baseProduction: 2,
  nodeProduction: 1,
  nodeGarrison: 3,
  blockedPairs: 6,
  homeBonus: 1,
  points: { plain: 1, node: 3, base: 1 },
  supply: true,
};
