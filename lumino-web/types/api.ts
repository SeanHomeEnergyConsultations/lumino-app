import type { MapProperty, PropertyDetail } from "@/types/entities";

export interface MapPropertiesResponse {
  items: MapProperty[];
}

export interface VisitResponse {
  visitId: string;
  propertyId: string;
}

export interface PropertyDetailResponse {
  item: PropertyDetail;
}

export interface ResolvePropertyResponse {
  propertyId: string;
  created: boolean;
}
