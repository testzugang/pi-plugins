# Interface Design Guidelines

1.  **Smallest possible surface area**: Only expose what is absolutely necessary.
2.  **Domain-driven**: Use names from `CONTEXT.md`.
3.  **Explicit errors**: Make error modes part of the interface.
4.  **Configuration over implementation**: Let callers configure behavior through the interface rather than reaching into the implementation.
5.  **Invariants**: Clearly define what the module assumes to be true.
