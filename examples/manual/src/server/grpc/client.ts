import grpc from "@grpc/grpc-js";
import protoLoader from "@grpc/proto-loader";
import { PROTO_ROOT, VEHICLE_PROTO } from "../config";

export function loadGrpcClient(target: string): any {
  const packageDefinition = protoLoader.loadSync(VEHICLE_PROTO, {
    keepCase: true,
    longs: Number,
    enums: String,
    defaults: true,
    oneofs: true,
    includeDirs: [PROTO_ROOT]
  });
  const descriptor = grpc.loadPackageDefinition(packageDefinition) as any;
  return new descriptor.artemis_mudri.simulation.v1.VehicleSimulationService(
    target,
    grpc.credentials.createInsecure()
  );
}
