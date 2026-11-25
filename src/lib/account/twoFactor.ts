import { prisma } from "@/lib/db";
import { formatTag } from "@/lib/handle";
import type { MessageKey,Vars } from "@/lib/i18n/core";
import { clearFailures,failureLockSeconds,registerFailure,tooManyAttempts } from "@/lib/rateLimit";
import { consumeRecoveryCode,createOtpauthUri,decryptTotpSecret,encryptTotpSecret,generateRecoveryCodes,generateTotpSecret,hashRecoveryCodes,TWO_FACTOR_MAX_FAILURES,TWO_FACTOR_WINDOW_MS,twoFactorFailureKey,verifyTotpCode } from "@/lib/totp";
import { commitAccountMutation,type AccountActor } from "./mutation";
import type { TwoFactorCommand,TwoFactorResult } from "./twoFactorContract";

export class TwoFactorSettingsError extends Error {
  constructor(readonly key:MessageKey,readonly status:number,readonly vars?:Vars){super(key);}
}
/** De bestaande vier webacties; dezelfde actor-/sessiecommit als overige profielmutaties. */
export async function manageTwoFactor(actor:AccountActor,command:TwoFactorCommand):Promise<TwoFactorResult>{
  const failureKey=twoFactorFailureKey(actor.userId);
  const locked=failureLockSeconds(failureKey,TWO_FACTOR_MAX_FAILURES);
  if(locked>0){const [key,vars]=tooManyAttempts(locked);throw new TwoFactorSettingsError(key,429,vars);}
  const invalid=(key:MessageKey):never=>{registerFailure(failureKey,TWO_FACTOR_WINDOW_MS);throw new TwoFactorSettingsError(key,400);};
  // Het dure hashen blijft buiten de korte commit. Voor en tijdens de commit
  // opnieuw hetzelfde verse bewijs controleren; nooit de sessiecookie als bewijs.
  let recoveryCodes:string[]=[],recoveryHashes:string|null=null;
  if(command.kind==="verify"){
    const user=await prisma.user.findUnique({where:{id:actor.userId},select:{totpSecretEncrypted:true}});
    if(!user?.totpSecretEncrypted)throw new TwoFactorSettingsError("apiErrors.startTwoFactorSetupFirst",400);
    if(!verifyTotpCode(decryptTotpSecret(user.totpSecretEncrypted),command.code))invalid("apiErrors.verificationCodeWrong");
    recoveryCodes=generateRecoveryCodes();recoveryHashes=await hashRecoveryCodes(recoveryCodes);
  }
  const result=await commitAccountMutation(actor,[],async tx=>{
    const user=await tx.user.findUniqueOrThrow({where:{id:actor.userId}});
    if(command.kind==="setup"){
      if(user.totpEnabled)throw new TwoFactorSettingsError("apiErrors.twoFactorAlreadyOn",400);
      const secret=generateTotpSecret();
      await tx.user.update({where:{id:user.id},data:{totpSecretEncrypted:encryptTotpSecret(secret)}});
      return {secret,otpauthUri:createOtpauthUri(secret,formatTag(user.handle,user.discriminator))};
    }
    if(command.kind==="verify"){
      if(!user.totpSecretEncrypted)throw new TwoFactorSettingsError("apiErrors.startTwoFactorSetupFirst",400);
      if(!verifyTotpCode(decryptTotpSecret(user.totpSecretEncrypted),command.code))invalid("apiErrors.verificationCodeWrong");
      await tx.user.update({where:{id:user.id},data:{totpEnabled:true,totpRecoveryCodes:recoveryHashes}});
      return {ok:true as const,recoveryCodes};
    }
    if(command.kind==="disable" && user.isAdmin)throw new TwoFactorSettingsError("apiErrors.twoFactorAdminRequired",403);
    if(!user.totpEnabled || !user.totpSecretEncrypted)throw new TwoFactorSettingsError("apiErrors.twoFactorNotOn",400);
    if(command.kind==="reset"){
      const remaining=await consumeRecoveryCode(user.totpRecoveryCodes,command.code);
      if(!remaining)invalid("apiErrors.recoveryCodeWrong");
      const secret=generateTotpSecret();
      await tx.user.update({where:{id:user.id},data:{totpSecretEncrypted:encryptTotpSecret(secret),totpRecoveryCodes:remaining}});
      return {secret,otpauthUri:createOtpauthUri(secret,formatTag(user.handle,user.discriminator))};
    }
    if(!verifyTotpCode(decryptTotpSecret(user.totpSecretEncrypted),command.code) && !await consumeRecoveryCode(user.totpRecoveryCodes,command.code))invalid("apiErrors.codeWrong");
    await tx.user.update({where:{id:user.id},data:{totpEnabled:false,totpSecretEncrypted:null,totpRecoveryCodes:null}});
    return {ok:true as const};
  });
  clearFailures(failureKey);
  return result;
}
