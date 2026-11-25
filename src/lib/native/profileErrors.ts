import type { MessageKey,TFunction } from "@/lib/i18n/core";
import { NativeClientError } from "./client";
const keys=["apiErrors.nothingToSave","apiErrors.invalidInput","apiErrors.languageUnavailable","apiErrors.uniqueHandleFailed","apiErrors.twoFactorAlreadyOn","apiErrors.twoFactorAdminRequired","apiErrors.twoFactorNotOn","apiErrors.startTwoFactorSetupFirst","apiErrors.verificationCodeWrong","apiErrors.recoveryCodeWrong","apiErrors.codeWrong"] as const satisfies readonly MessageKey[];
export function nativeProfileErrorText(reason:unknown,t:TFunction,limitMinutes=1){
  if(reason instanceof NativeClientError){
    const key=keys.find(key=>key===reason.code);
    if(key)return t(key);
    if(reason.status===429)return t(limitMinutes===1?"apiErrors.tooManyAttemptsOne":"apiErrors.tooManyAttemptsMany",{n:limitMinutes});
    if(reason.code==="invalid_input")return t("apiErrors.invalidInput");
  }
  return t("apiErrors.notSaved");
}
