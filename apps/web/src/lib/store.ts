import { create } from "zustand";

interface UiState {
  navPinned: boolean; setNavPinned: (v: boolean) => void;
  sidePaneOpen: boolean; setSidePaneOpen: (v: boolean) => void;
}

export const useUi = create<UiState>((set) => ({
  navPinned: true,  setNavPinned: (v) => set({ navPinned: v }),
  sidePaneOpen: false, setSidePaneOpen: (v) => set({ sidePaneOpen: v }),
}));
