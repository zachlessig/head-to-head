// Online accounts (Supabase). Empty means the app runs on the phone only, the way it always has.
// url and anonKey are the project's public values, made to sit in browser code; row level
// security in supabase/migrations decides what each signed-in person can see.
window.H2H_CLOUD = {
  url: "",
  anonKey: "",
  providers: [], // "google" once Google sign-in is set up; "apple" needs Apple's paid developer program
};
