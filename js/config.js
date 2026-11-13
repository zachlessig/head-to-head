// Online accounts (Supabase). Empty means the app runs on the phone only, the way it always has.
// url and anonKey are the project's public values, made to sit in browser code; row level
// security in supabase/migrations decides what each signed-in person can see.
window.H2H_CLOUD = {
  url: "https://vqgbtssybgaqietjbqms.supabase.co",
  anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZxZ2J0c3N5YmdhcWlldGpicW1zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQzNjY0MDIsImV4cCI6MjEwOTk0MjQwMn0.yQXqOggTRExjnxCqKxs2vxhH7brWhBHEFW_3hpT1ENA",
  providers: [], // "google" once Google sign-in is set up; "apple" needs Apple's paid developer program
};
