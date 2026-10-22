// For room and building names.
//
// These used to be set in Non Natural Grotesk, which made Classrooms and
// Bathrooms read differently from the rest of the site. They now use the app
// font (BerkeleyMono, set on .radix-themes) and lean on weight alone, so room
// names still stand out without switching typeface.
export const ROOM_NAME = { fontWeight: 700 } as const;
