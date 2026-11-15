import type {ReactNode} from "react";
import WebGameSearchProvider from "./WebGameSearchProvider";
/** Web levert de Next-querycontext; native vervangt uitsluitend deze platformpoort. */
export default function WebGameBoundary({children}:{children:ReactNode}) {
  return <WebGameSearchProvider>{children}</WebGameSearchProvider>;
}
