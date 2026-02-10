# API Gateway — Go  (LEARNING GUIDE)

## Key Concepts Demonstrated

### 1. Error Handling (the biggest Go culture shock)
Go has **no exceptions**. Every function that can fail returns an `error`:
```go
result, err := doSomething()
if err != nil {
    // handle it — don't ignore!
}
```
This feels verbose at first, but it makes error paths explicit. You
can never be surprised by an uncaught exception — the compiler forces
you to deal with (or deliberately ignore) every error.

**Study**: Every function in `store/store.go`.

### 2. Struct Methods (Go's "classes")
Go has no classes. Instead, you attach methods to structs:
```go
type Handler struct { store *store.Store }
func (h *Handler) Health(w http.ResponseWriter, r *http.Request) { ... }
```
The `(h *Handler)` part is called a **receiver** — it's like `this` or `self`.

**Study**: `handlers/handlers.go` — all methods on `Handler`.

### 3. Struct Tags (JSON serialisation)
```go
type Event struct {
    Title *string `json:"title,omitempty"`
}
```
The backtick string after a field is a **struct tag**. The `json` tag
controls how the field appears when serialised to JSON. `omitempty`
skips the field if it's nil/zero.

**Study**: `store/store.go` — the `Event` and `Stats` structs.

### 4. Pointers vs Values
`*string` means "pointer to string" — it can be `nil` (absent).
Plain `string` always has a value (at minimum, empty `""`).
We use `*string` for nullable database columns.

### 5. Go 1.22 Routing Patterns
```go
mux.HandleFunc("GET /api/events", h.ListEvents)
```
Before Go 1.22, the stdlib router couldn't distinguish HTTP methods.
Now it can — no need for chi or gorilla/mux for simple APIs.

### 6. Graceful Shutdown
The main goroutine runs the server; a background goroutine
waits for SIGINT. When Ctrl-C is pressed, the background goroutine
calls `srv.Shutdown()` which lets in-flight requests finish.

---

## Project Structure (idiomatic Go)

```
api-gateway/
├── cmd/server/main.go    # Entry point — wires everything together
└── internal/             # Private packages (can't be imported externally)
    ├── handlers/         # HTTP request handlers
    └── store/            # Database access layer
```

`cmd/` is for executables, `internal/` is for packages that are specific
to this project. This is the standard Go project layout.

---

## Resources

- [Effective Go](https://go.dev/doc/effective_go)
- [Go by Example](https://gobyexample.com/)
- [Let's Go (book)](https://lets-go.alexedwards.net/)
- [Standard library docs](https://pkg.go.dev/std)
