import Constants from "expo-constants";

const appVariant = Constants.expoConfig?.extra?.appVariant;

export const BRAND_MARK_SOURCE =
  appVariant === "development"
    ? require("../../assets/gradespace/ios-icon-dev.png")
    : appVariant === "preview"
      ? require("../../assets/gradespace/ios-icon-preview.png")
      : require("../../assets/gradespace/ios-icon-prod.png");
