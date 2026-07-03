# Matching Engine folder structure

We use the following build system for our C++ project:

1. CMake - CMake is the standard project build configuration layer. We can write CMakeLists.txt, and it will generate the real build files for Ninja, Make, Visual Studio, etc.
1. Ninja - Ninja is a small, low-level build system focused entirely on speed and efficiency. CMake can generate Ninja files.
1. Conan - Conan is like Maven/npm/go modules because it handles C/C++ dependencies and versions. It works with CMake and can manage libraries.


## Folder structure

The following folder structure can be used for matching engine


```
matching-engine/
├── CMakeLists.txt
├── CMakePresets.json
├── conanfile.txt
├── README.md
├── .clang-format
├── .clang-tidy
├── .gitignore
├── .github/
│   └── workflows/
│       └── ci.yml
│
├── include/  # Contains header files
│   └── gridx/
│      └── matching/
|          |
|          ├── common/
|          │   ├── Logger.hpp
|          |   ├── Types.hpp
|          │   └── Utils.hpp
|          |
│          ├── domain/
│          │   ├── Order.hpp
│          │   ├── Trade.hpp
│          │   ├── MarketId.hpp
│          │   ├── Price.hpp
│          │   └── Quantity.hpp
│          │
│          ├── orderbook/
│          │   ├── MarketBook.hpp
│          │   ├── ZoneOrderBook.hpp
│          │   ├── OrderBookSide.hpp
│          │   ├── PriceLevel.hpp
│          │   └── MarketBookManager.hpp
│          │
│          ├── matcher/
│          │   ├── Matcher.hpp
│          │   ├── CrossZoneMatcher.hpp
│          │   ├── EffectivePriceCalculator.hpp
│          │   ├── MatchingResult.hpp
│          │   └── MatchingAlgorithm.hpp
│          │
│          ├── engine/
│          │   ├── MatchingEngine.hpp
│          │   ├── OrderProcessor.hpp
│          │   ├── MarketRouter.hpp
│          │   ├── ExpiryManager.hpp
│          │   └── RecoveryManager.hpp
│          │
│          ├── config/
│          │   ├── MarketConfigCache.hpp
│          │   ├── TariffCache.hpp
│          │   ├── GridTransferCache.hpp
│          │   └── GridTopologyCache.hpp
│          │
│          └── ports/
│              ├── OrderEventConsumer.hpp
│              ├── TradeEventPublisher.hpp
│              └── RecoveryClient.hpp
│
├── src/ # Contains implementations of above header files
│   ├── main.cpp
│   ├── domain/
│   ├── orderbook/
│   ├── matcher/
│   ├── engine/
│   ├── config/
│   └── adapters/
│       ├── kafka/
│       |   ├── KafkaOrderConsumer.cpp
│       │   ├── KafkaEventPublisher.cpp
│       │   └── KafkaConfigConsumer.cpp
│       ├── codec/
│       │   ├── ProtobufOrderCodec.cpp
│       │   ├── ProtobufTradeCodec.cpp
│       │   ├── ProtobufMarketConfigCodec.cpp
│       │   ├── TradeEventMapper.cpp
│       │   ├── ProtobufGridRuleCodec.cpp
│       │   └── OrderEventMapper.cpp
│       └── recovery/
│
├── tests/
│   ├── unit/
│   │   ├── OrderBookTest.cpp
│   │   ├── MatcherTest.cpp
│   │   └── TariffCacheTest.cpp
│   │
│   ├── integration/
│   │   ├── KafkaFlowTest.cpp
│   │   └── RecoveryTest.cpp
│   │
│   └── benchmark/
│       ├── OrderBookBenchmark.cpp
│       └── MatchingBenchmark.cpp
│
├── scripts/
│   ├── run-local.sh
│   └── benchmark.sh
├── Dockerfile
└── docker-compose.yml
```

## Files & Folders explained

* `CMakeLists.txt`
    This is the main build definition file for the C++ project.

    It tells CMake:

    * What the project is called
    * Which C++ standard to use
    * Which source files to compile
    * Which libraries to build
    * Which executable to build
    * Which dependencies to link
    * Where header files are located
    * How tests are registered

    Example config:

    ```cmake
    cmake_minimum_required(VERSION 3.24)

    project(gridx_matching_engine LANGUAGES CXX)

    set(CMAKE_CXX_STANDARD 20)
    set(CMAKE_CXX_STANDARD_REQUIRED ON)

    add_library(gridx_matching_core
        src/orderbook/OrderBook.cpp
        src/matcher/Matcher.cpp
        src/application/MatchingEngine.cpp
    )

    target_include_directories(gridx_matching_core
        PUBLIC
            include
    )

    add_executable(matching-engine
        src/main.cpp
    )

    target_link_libraries(matching-engine
        PRIVATE
            gridx_matching_core
    )
    ```

* `CMakePresets.json`

    This stores common build configurations so every developer can build the project the same way.

    Example:

    ```json
    {
        "version": 6,
        "configurePresets": [
            {
                "name": "debug",
                "generator": "Ninja",
                "binaryDir": "build/debug",
                "cacheVariables": {
                    "CMAKE_BUILD_TYPE": "Debug",
                    "CMAKE_EXPORT_COMPILE_COMMANDS": "ON"
                }
            },
            {
                "name": "release",
                "generator": "Ninja",
                "binaryDir": "build/release",
                "cacheVariables": {
                    "CMAKE_BUILD_TYPE": "Release"
                }
            }
        ]
    }
    ```

    The above example allows developers to run the following commands:

    ```bash
    cmake --preset debug
    cmake --build build/debug
    ```
* `conanfile.txt`

    C++ dependency file for conan (like a package manager). It declares external libraries for our project.

    Example:

    ```txt
    [requires]
    protobuf/5.27.0
    librdkafka/2.5.0
    yaml-cpp/0.8.0
    spdlog/1.14.1
    fmt/10.2.1
    gtest/1.14.0
    benchmark/1.8.3
    gridx-sdk-cpp/0.1.0

    [generators]
    CMakeDeps
    CMakeToolchain

    [layout]
    cmake_layout
    ```

    Then dependencies can be installed via

    ```bash
    conan install . --output-folder=build --build=missing
    ```

* `.clang-format`

    This defines automatic code formatting rules

    Example:

    ```
    BasedOnStyle: Google
    IndentWidth: 4
    ColumnLimit: 100
    PointerAlignment: Left
    SortIncludes: true
    ```

    Then devs can run the following command to format files:

    ```bash
    clang-format -i src/**/*.cpp include/**/*.hpp
    ```

* `.clang-tidy`

    This defines static analysis rules. `clang-tidy` checks code for potential bugs, unsafe patterns, performance issues, and style problems.

    ```
    Checks: >
        bugprone-*,
        performance-*,
        modernize-*,
        readability-*,
        cppcoreguidelines-*

    WarningsAsErrors: ''
    ```

* `include/`
    Contains the header files, types, prototypes, contracts, etc

* `src/`
    Contains logic and implementations of the above header files