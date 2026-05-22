# Architectural Language

### Depth vs. Shallowness

A **deep** module is one that provides powerful functionality through a simple interface. A **shallow** module is one whose interface is complex relative to the functionality it provides.

### The Seam

A seam is a place where you can alter behavior in your program without editing in that place. Seams are the foundation of testability.

### Locality

Locality means that related things are close together. In a deep module, the implementation details are hidden (local), and the interface is the only thing exposed to the outside world.
