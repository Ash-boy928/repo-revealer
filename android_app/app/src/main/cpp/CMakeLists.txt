cmake_minimum_required(VERSION 3.22)
project(leonative)

# nodejs-mobile headers + libnode.so are placed here by the CI workflow
set(NODE_DIR ${CMAKE_SOURCE_DIR}/libnode)
include_directories(${NODE_DIR}/include/node)

add_library(native-lib SHARED native-lib.cpp)
add_library(libnode SHARED IMPORTED)
set_target_properties(libnode PROPERTIES IMPORTED_LOCATION
    ${CMAKE_SOURCE_DIR}/../jniLibs/${ANDROID_ABI}/libnode.so)

find_library(log-lib log)
target_link_libraries(native-lib libnode ${log-lib})
