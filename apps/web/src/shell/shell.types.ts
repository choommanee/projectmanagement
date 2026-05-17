export interface AppDef {
  id: string;
  name: string;
  icon?: string;
  areas: AppArea[];
}

export interface AppArea {
  id: string;
  name: string;
  groups: AppGroup[];
}

export interface AppGroup {
  id: string;
  name: string;
  subareas: AppSubarea[];
}

export interface AppSubarea {
  id: string;
  name: string;
  href: string;
  entity?: string;
  icon?: string;
  count?: number;
}

export interface UserCtx {
  id: string;
  displayName: string;
  email: string;
  tenantSlug: string;
}
