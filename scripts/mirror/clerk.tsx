import { Button, DropdownMenu, IconButton } from '@radix-ui/themes';
import { cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react';
const getToken=async()=> 'local-mirror-not-a-jwt';
export function useAuth(){return {getToken,isLoaded:true,isSignedIn:true};}
export function UserButton({children}:{children?:ReactNode}){return <DropdownMenu.Root><DropdownMenu.Trigger><IconButton size="1" radius="full" aria-label="Preview account">P</IconButton></DropdownMenu.Trigger><DropdownMenu.Content><DropdownMenu.Label>Local preview account</DropdownMenu.Label>{children}</DropdownMenu.Content></DropdownMenu.Root>;}
UserButton.MenuItems=({children}:{children?:ReactNode})=><>{children}</>;
UserButton.Action=({label,labelIcon,onClick}:{label:string,labelIcon?:ReactNode,onClick:()=>void})=><DropdownMenu.Item onSelect={onClick}>{labelIcon}{label}</DropdownMenu.Item>;
export function SignInButton({children}:{children?:ReactNode}){return <span title="Local preview account; production sign-in is unchanged">{isValidElement(children)?cloneElement(children as ReactElement<{disabled:boolean}>,{disabled:true}):<Button disabled>Preview only</Button>}</span>;}
