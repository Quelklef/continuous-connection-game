{
  inputs =
    {
      nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
      shelpers.url = "gitlab:platonic/shelpers";
    };

  outputs = inputs:
    let
      system = "x86_64-linux";
      p = inputs.nixpkgs.legacyPackages.${system};

      shelpers = (inputs.shelpers.lib p).eval-shelpers [
        ({ shelp, ... }: {
          shelpers."."."General" = {
            inherit shelp;

            "client.run" = {
              description = "run the dev client";
              script = ''bun run dev --host'';
            };

            "ws-server.run" = {
              description = "run the websocket";
              script = ''bun run server/server.js'';
            };

            "client.check" = {
              description = "Run type check watching on the client codebase";
              script = ''bun check --watch'';
            };

            "ws-server.check" = {
              description = "Run type check watching on the the websocket server codebase";
              script = ''tsc -w --noEmit --strict --noUnusedLocals --noUnusedParameters --allowImportingTsExtensions server/server.ts'';
            };
          };
        })
      ];
    in
    {
      devShells.${system}.default = p.mkShell {
        buildInputs = with p; [
          bun
          typescript
        ];

        shellHook = ''
          ${shelpers.functions}
          shelp
        '';
      };

      formatter.${system} = p.nixpkgs-fmt;
      apps.${system} = shelpers.apps;
      shelpers.${system} = shelpers.files;
    };
}
