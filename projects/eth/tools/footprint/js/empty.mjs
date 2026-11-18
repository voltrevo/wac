// An empty stand-in for Node built-ins that the bundled code imports but the light-client task never calls
// (Lodestar debug helpers, the API package's EventSource). docs/footprint.md says where it is used.
export default {};
