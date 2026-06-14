export const STFC_MOD_PAYLOAD_RESOURCE_VERSION = "stfc.payload-resource.v0" as const;

export type PayloadResourceCategory = "observation" | "derived" | "intent" | "dispatch";

export type PayloadResourceJsonPrimitive = string | number | boolean | null;

export type PayloadResourceJsonValue =
  | PayloadResourceJsonPrimitive
  | PayloadResourceJsonObject
  | readonly PayloadResourceJsonValue[];

export interface PayloadResourceJsonObject {
  readonly [key: string]: PayloadResourceJsonValue;
}

export interface PayloadResourceReference {
  readonly resourceType: string;
  readonly id: string;
  readonly profile?: string;
}

export interface PayloadResourceProvenance {
  readonly source: string;
  readonly producer?: string;
  readonly seam?: string;
  readonly reason?: string;
  readonly observedAt?: string;
  readonly generatedAt?: string;
  readonly eventKey?: string;
  readonly sequenceId?: number;
  readonly derivedFrom?: readonly PayloadResourceReference[];
}

export type PayloadResourceExtensions = Readonly<Record<string, PayloadResourceJsonValue>>;

export interface PayloadResourceEnvelope<
  TDetails extends object = PayloadResourceJsonObject,
  TResourceType extends string = string,
  TProfile extends string = string,
> {
  readonly resourceVersion: typeof STFC_MOD_PAYLOAD_RESOURCE_VERSION;
  readonly resourceType: TResourceType;
  readonly profile: TProfile;
  readonly category: PayloadResourceCategory;
  readonly id: string;
  readonly timestamp: string;
  readonly provenance: PayloadResourceProvenance;
  readonly details: TDetails;
  readonly extensions?: PayloadResourceExtensions;
  readonly missingEvidence?: readonly string[];
}
