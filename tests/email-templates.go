// Run from repository root: go run tests/email-templates.go
package main

import (
 "bytes"
 "encoding/json"
 "fmt"
 "html/template"
 "os"
 "strings"
)

func main() {
 subjects := map[string]string{}
 raw, err := os.ReadFile("supabase/templates/auth-subjects.json"); if err != nil { panic(err) }
 if err = json.Unmarshal(raw, &subjects); err != nil { panic(err) }
 for _, path := range []string{"confirmation", "recovery"} {
  body, err := os.ReadFile("supabase/templates/"+path+".html"); if err != nil { panic(err) }
  subjects[path+"_body"] = string(body)
 }
 for name, content := range subjects {
  t := template.Must(template.New(name).Parse(content))
  for _, redirect := range []string{"", "https://elestet.net/", "https://elestet.net/auth-email/2026-10-02T01:52:30Z", "https://elestet.net/auth-email/2026-10-02T01:52:30Z/1", "https://elestet.net/auth-email/2026-10-02T01:53:31Z/12345"} {
   var out bytes.Buffer
   err := t.Execute(&out, map[string]any{"RedirectTo": redirect, "Token": "123456"}); if err != nil { panic(err) }
   rendered := out.String()
   if len(redirect) >= 53 {
    stamp := redirect[len("https://elestet.net/auth-email/"):]
    expected := "02.10.2026, "+stamp[11:19]+" UTC"
    number := redirect[52:]
    if !strings.Contains(strings.ToLower(rendered), "письмо №"+number) { panic("number mismatch: "+name) }
    if strings.HasSuffix(name, "_body") && !strings.Contains(rendered, expected) { panic("timestamp mismatch: "+name) }
    if strings.HasPrefix(name, "mailer_subjects_") && strings.Contains(rendered, "UTC") { panic("timestamp in subject") }
   } else if strings.Contains(rendered, "UTC") { panic("fabricated timestamp: "+name) }
   if strings.HasPrefix(name, "mailer_subjects_") && strings.Contains(rendered, "123456") { panic("OTP in subject") }
   if strings.Contains(rendered, "href=") { panic("unexpected confirmation link") }
  }
 }
 fmt.Println("email_templates_ok: matching numbers, footer timestamps, resends, legacy fallback, no OTP in subject")
}
